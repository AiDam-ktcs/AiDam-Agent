from flask import Flask, render_template
from flask_sock import Sock
import json
import base64
import audioop
import wave
from datetime import datetime
import os
import sys
import numpy as np
import torch
import librosa
import soundfile as sf
import requests

# 프로젝트 루트 경로 추가
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

# Denoiser 경로 추가
denoiser_directory = os.path.join(BASE_DIR, 'src', 'denoiser')
sys.path.append(denoiser_directory)

from denoiser import pretrained
import nemo.collections.asr as nemo_asr
from transformers import AutoModelForCausalLM, AutoTokenizer
import re
import unicodedata

# KenLM import
try:
    import kenlm
    HAS_KENLM = True
except ImportError:
    HAS_KENLM = False
    print("⚠️ kenlm이 설치되지 않았습니다. Greedy 디코딩만 사용합니다.")

# 설정 파일 import
try:
    from config import (
        HTTP_SERVER_PORT,
        SAMPLE_RATE_INPUT,
        SAMPLE_RATE_TARGET,
        CHUNK_DURATION,
        CHUNK_OVERLAP,
        MIN_AUDIO_LENGTH,
        MIN_ENERGY_THRESHOLD,
        AUDIO_NORMALIZATION,
        DENOISE_DRY_MIX,
        ENABLE_BEAM_SEARCH,
        BEAM_DECODER_TYPE,
        BEAM_WIDTH,
        LM_ALPHA,
        LM_BETA,
        BEAM_TOPK,
        DEBUG_BEAM_SEARCH,
        KENLM_MODEL_PATH,
        DENOISER_MODEL_PATH,
        ASR_MODEL_PATH,
        KEYWORD_MODEL_PATH,
        RECORDINGS_DIR,
        MAINBACKEND_URL,
        MAINBACKEND_ENABLED,
        MAINBACKEND_TIMEOUT
    )
except ImportError:
    # config.py가 없는 경우 기본값 사용
    HTTP_SERVER_PORT = 5000
    SAMPLE_RATE_INPUT = 8000
    SAMPLE_RATE_TARGET = 16000
    CHUNK_DURATION = 4.0
    CHUNK_OVERLAP = 0.5
    MIN_AUDIO_LENGTH = 0.3
    MIN_ENERGY_THRESHOLD = 0.01
    AUDIO_NORMALIZATION = True
    DENOISE_DRY_MIX = 0.02
    ENABLE_BEAM_SEARCH = False
    BEAM_DECODER_TYPE = "simple"
    BEAM_WIDTH = 64
    LM_ALPHA = 0.5
    LM_BETA = 0.1
    BEAM_TOPK = 100
    DEBUG_BEAM_SEARCH = False
    KENLM_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'korean_lm.bin')
    DENOISER_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'denoiser.th')
    ASR_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'Conformer-CTC-BPE.nemo')
    KEYWORD_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'qwen3-1.7b')
    RECORDINGS_DIR = os.path.join(BASE_DIR, 'call_recordings')
    MAINBACKEND_URL = 'http://localhost:3000'
    MAINBACKEND_ENABLED = True
    MAINBACKEND_TIMEOUT = 5

class SimpleCTCBeamDecoder:
    """
    단어 경계 기반 CTC Beam Search Decoder with KenLM
    
    NeMo BPE 토크나이저와 단어 기반 KenLM의 호환성을 위해
    단어가 완성될 때만 LM 스코어를 적용합니다.
    """
    
    def __init__(self, vocab, lm_path, beam_width=32, alpha=0.5, beta=0.1, topk=100, debug=False):
        """
        Args:
            vocab: vocabulary list (BPE tokens)
            lm_path: KenLM 모델 경로
            beam_width: beam 크기
            alpha: LM weight (단어 기반이므로 낮은 값 권장)
            beta: word insertion bonus (단어 완성 시 적용)
            topk: 각 타임스텝에서 고려할 상위 토큰 수
            debug: 디버그 모드 (상세 로깅)
        """
        self.vocab = vocab
        # NeMo CTC outputs have shape [time, vocab_size + blank + padding]
        # For safety, we'll detect blank_id from actual logits shape during decode
        self.blank_id = None  # Will be set during first decode call
        self.beam_width = beam_width
        self.alpha = alpha
        self.beta = beta
        self.topk = topk
        self.debug = debug
        
        # KenLM 로드
        if HAS_KENLM and lm_path and os.path.exists(lm_path):
            self.lm = kenlm.Model(lm_path)
            try:
                log(f"  [OK] KenLM loaded: {os.path.basename(lm_path)}")
            except:
                pass
        else:
            self.lm = None
            try:
                log("  [WARN] KenLM not available, using CTC only")
            except:
                pass
    
    def _compute_lm_score(self, completed_words):
        """완성된 단어 리스트로 LM 스코어 계산"""
        if not self.lm or not completed_words:
            return 0.0
        
        sentence = ' '.join(completed_words)
        if not sentence:
            return 0.0
        
        # KenLM 스코어 + 단어 개수 보너스
        lm_prob = self.lm.score(sentence, bos=True, eos=False)
        word_bonus = self.beta * len(completed_words)
        return self.alpha * lm_prob + word_bonus
    
    def decode(self, log_probs):
        """
        CTC log probabilities를 단어 경계 기반으로 디코딩
        
        Args:
            log_probs: numpy array [time, vocab_size]
            
        Returns:
            decoded text (str)
        """
        T, V = log_probs.shape
        
        # Auto-detect blank_id on first call
        if self.blank_id is None:
            # Blank is typically the last valid token
            self.blank_id = V - 1
            try:
                log(f"[BeamSearch] Auto-detected blank_id: {self.blank_id} (vocab_size={len(self.vocab)}, logits_size={V})")
            except:
                pass
        
        if self.debug:
            try:
                log(f"[BeamSearch] Starting decode: T={T}, V={V}, blank_id={self.blank_id}")
            except:
                pass
        
        # Beam state: {key: (ctc_score, lm_score, last_token_id, current_word, completed_words)}
        # key = (tuple of completed words, current word building)
        initial_key = (tuple(), '')
        beams = {initial_key: (0.0, 0.0, None)}
        
        for t in range(T):
            probs = log_probs[t]
            
            # Top-K pruning for speed
            top_k_ids = np.argsort(probs)[-self.topk:]
            
            if self.debug and t < 3:  # 처음 3 타임스텝만 로깅
                top_3 = np.argsort(probs)[-3:][::-1]
                top_tokens = [(i, self.vocab[i] if i < len(self.vocab) else '<unk>', probs[i]) 
                             for i in top_3]
                log(f"  [t={t}] Top-3: {top_tokens}")
            
            new_beams = {}
            
            for (completed_tuple, current_word), (ctc_score, lm_score, last_token_id) in beams.items():
                for token_id in top_k_ids:
                    token_prob = probs[token_id]
                    new_ctc = ctc_score + token_prob
                    
                    if token_id == self.blank_id:
                        # Blank: 상태 유지
                        key = (completed_tuple, current_word)
                        if key not in new_beams or new_ctc + lm_score > new_beams[key][0] + new_beams[key][1]:
                            new_beams[key] = (new_ctc, lm_score, None)
                    
                    elif token_id == last_token_id:
                        # CTC collapse: 같은 토큰 연속
                        key = (completed_tuple, current_word)
                        if key not in new_beams or new_ctc + lm_score > new_beams[key][0] + new_beams[key][1]:
                            new_beams[key] = (new_ctc, lm_score, token_id)
                    
                    else:
                        # 새 토큰 추가
                        token = self.vocab[token_id] if token_id < len(self.vocab) else ''
                        
                        if not token:
                            continue
                        
                        # ▁로 시작하면 새 단어 시작
                        if token.startswith('▁'):
                            # 현재 단어를 완성하고 새 단어 시작
                            new_completed = list(completed_tuple)
                            if current_word:  # 이전 단어가 있으면 완성
                                new_completed.append(current_word)
                            
                            # 새 단어 시작 (▁ 제거)
                            new_current = token.replace('▁', '')
                            
                            # LM 스코어 재계산 (단어가 완성되었으므로)
                            new_lm = self._compute_lm_score(new_completed) if new_completed else 0.0
                            
                            if self.debug and t < 5 and new_completed:
                                log(f"  [t={t}] Word completed: '{current_word}' → {new_completed[-1]}, LM={new_lm:.2f}")
                        
                        else:
                            # subword 추가 (단어 계속 구성 중)
                            new_completed = completed_tuple
                            new_current = current_word + token
                            new_lm = lm_score  # LM 스코어 유지 (단어 미완성)
                        
                        key = (tuple(new_completed), new_current)
                        if key not in new_beams or new_ctc + new_lm > new_beams[key][0] + new_beams[key][1]:
                            new_beams[key] = (new_ctc, new_lm, token_id)
            
            # Beam pruning: top beam_width만 유지
            beams = dict(sorted(new_beams.items(), 
                               key=lambda x: x[1][0] + x[1][1],  # ctc + lm
                               reverse=True)[:self.beam_width])
            
            if self.debug and t < 3:
                top_beam = sorted(beams.items(), key=lambda x: x[1][0] + x[1][1], reverse=True)[0]
                (comp, curr), (ctc, lm, _) = top_beam
                log(f"  [t={t}] Best: completed={list(comp)}, current='{curr}', ctc={ctc:.2f}, lm={lm:.2f}")
        
        # Best hypothesis 선택 및 최종 처리
        if not beams:
            return ""
        
        best_key, (ctc_score, lm_score, _) = max(beams.items(), key=lambda x: x[1][0] + x[1][1])
        completed_words, current_word = best_key
        
        # 마지막 단어 추가 (아직 완성 안된 단어)
        final_words = list(completed_words)
        if current_word:
            final_words.append(current_word)
        
        result = ' '.join(final_words)
        
        if self.debug:
            log(f"[BeamSearch] Final result: '{result}' (ctc={ctc_score:.2f}, lm={lm_score:.2f})")
        
        return result

app = Flask(__name__)
sock = Sock(app)

# 전역 변수로 모델 저장
denoiser_model = None
asr_model = None
keyword_model = None
keyword_tokenizer = None
device = None
ctc_decoder = None  # SimpleCTC Beam Search 디코더
USE_BEAM_SEARCH = False  # Beam Search 사용 여부
BEAM_DECODER_MODE = "simple"  # "simple" or "nemo"

def log(msg, *args):
    print(f"Media WS: ", msg, *args)

def notify_call_start(call_info):
    """MainBackend에 통화 시작 알림"""
    if not MAINBACKEND_ENABLED:
        return
    
    try:
        response = requests.post(
            f'{MAINBACKEND_URL}/api/stt/call-start',
            json={
                'callId': call_info['call_sid'],
                'phoneNumber': call_info['from_number'],
                'timestamp': call_info['timestamp']
            },
            timeout=MAINBACKEND_TIMEOUT
        )
        if response.status_code == 200:
            log(f"✓ Call start notified to MainBackend")
        else:
            log(f"✗ MainBackend error: {response.status_code}")
    except Exception as e:
        log(f"✗ Failed to notify MainBackend: {e}")

def send_transcription_to_mainbackend(call_sid, speaker, text, keywords):
    """MainBackend에 실시간 전사 결과 전송"""
    if not MAINBACKEND_ENABLED or not text:
        return
    
    speaker_map = {'inbound': 'customer', 'outbound': 'agent'}
    
    try:
        response = requests.post(
            f'{MAINBACKEND_URL}/api/stt/line',
            json={
                'callId': call_sid,
                'speaker': speaker_map.get(speaker, 'customer'),
                'text': text,
                'keywords': keywords or []
            },
            timeout=MAINBACKEND_TIMEOUT
        )
        if response.status_code == 200:
            log(f"✓ Sent to MainBackend [{speaker}]: {text[:50]}")
        else:
            log(f"✗ MainBackend error: {response.status_code}")
    except requests.exceptions.Timeout:
        log(f"✗ MainBackend timeout (>{MAINBACKEND_TIMEOUT}s)")
    except Exception as e:
        log(f"✗ Failed to send to MainBackend: {e}")

def notify_call_end(call_sid):
    """MainBackend에 통화 종료 알림"""
    if not MAINBACKEND_ENABLED:
        return
    
    try:
        response = requests.post(
            f'{MAINBACKEND_URL}/call/end',
            json={'callId': call_sid},
            timeout=MAINBACKEND_TIMEOUT
        )
        if response.status_code == 200:
            log(f"✓ Call end notified to MainBackend")
        else:
            log(f"✗ MainBackend error: {response.status_code}")
    except Exception as e:
        log(f"✗ Failed to notify call end: {e}")

def load_models():
    """서버 시작 시 모델 로드"""
    global denoiser_model, asr_model, keyword_model, keyword_tokenizer, device, ctc_decoder, USE_BEAM_SEARCH, BEAM_DECODER_MODE
    
    log("Loading models...")
    
    # Device 설정
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    log(f"Using device: {device}")
    
    # Denoiser 모델 로드
    try:
        import argparse
        denoiser_args = argparse.Namespace(
            dns64=False,
            dns48=False,
            master64=False,
            device=str(device),
            dry=DENOISE_DRY_MIX,  # 더 강한 노이즈 제거 (0.04 → 0.02)
            model_path=DENOISER_MODEL_PATH
        )
        denoiser_model = pretrained.get_model(denoiser_args).to(device)
        denoiser_model.eval()
        log("✓ Denoiser model loaded successfully")
    except Exception as e:
        log(f"Warning: Could not load denoiser model: {e}")
        denoiser_model = None
    
    # ASR 모델 로드
    try:
        asr_model = nemo_asr.models.EncDecCTCModelBPE.restore_from(ASR_MODEL_PATH, map_location=device)
        asr_model.eval()
        
        # Preprocessor 설정
        from omegaconf import OmegaConf
        import copy
        asr_cfg = copy.deepcopy(asr_model._cfg)
        OmegaConf.set_struct(asr_cfg.preprocessor, False)
        asr_cfg.preprocessor.dither = 0.0
        asr_cfg.preprocessor.pad_to = 0
        OmegaConf.set_struct(asr_cfg.preprocessor, True)
        asr_model.preprocessor = asr_model.from_config_dict(asr_cfg.preprocessor)
        
        if device.type == 'cuda':
            asr_model.cuda()
        
        log("✓ ASR model loaded successfully")
        
        # Beam Search 설정
        if ENABLE_BEAM_SEARCH:
            # KenLM 모델 경로 확인
            kenlm_paths = [
                KENLM_MODEL_PATH,  # config.py에서 지정한 경로
                os.path.join(BASE_DIR, 'models', 'korean_4gram.binary'),
                os.path.join(BASE_DIR, 'models', 'korean_4gram.arpa'),
                os.path.join(BASE_DIR, 'models', 'korean_lm.bin'),
            ]
            
            kenlm_model_path = None
            for path in kenlm_paths:
                if os.path.exists(path):
                    kenlm_model_path = path
                    break
            
            if kenlm_model_path and HAS_KENLM:
                BEAM_DECODER_MODE = BEAM_DECODER_TYPE
                
                if BEAM_DECODER_TYPE == "nemo":
                    # NeMo 공식 BeamCTCInfer 사용
                    try:
                        from nemo.collections.asr.parts.submodules import ctc_beam_decoding
                        
                        # BeamCTCInferConfig 설정
                        beam_config = ctc_beam_decoding.BeamCTCInferConfig(
                            beam_size=BEAM_WIDTH,
                            beam_alpha=LM_ALPHA,
                            beam_beta=LM_BETA,
                            kenlm_path=kenlm_model_path,
                            return_best_hypothesis=True
                        )
                        
                        # ASR 모델에 decoding strategy 설정
                        asr_model.cfg.decoding.strategy = "beam"
                        asr_model.cfg.decoding.beam = beam_config
                        asr_model.change_decoding_strategy(asr_model.cfg.decoding)
                        
                        USE_BEAM_SEARCH = True
                        log("✅ NeMo BeamCTCDecoder initialized successfully")
                        log(f"   - Official NeMo implementation")
                        log(f"   - Optimized for CTC + KenLM")
                        log(f"   - KenLM model: {os.path.basename(kenlm_model_path)}")
                        log(f"   - Beam width: {BEAM_WIDTH}")
                        log(f"   - Alpha (LM weight): {LM_ALPHA}")
                        log(f"   - Beta (word bonus): {LM_BETA}")
                    except Exception as e:
                        log(f"Warning: NeMo decoder failed, falling back to SimpleCTC: {e}")
                        BEAM_DECODER_MODE = "simple"
                
                if BEAM_DECODER_MODE == "simple":
                    # SimpleCTCBeamDecoder 사용 (fallback)
                    try:
                        # Vocabulary 로드
                        vocab_path = os.path.join(BASE_DIR, 'src', 'nemo_asr', 'tokenizer_spe_bpe_v2048', 'vocab.txt')
                        with open(vocab_path, 'r', encoding='utf-8') as f:
                            vocab_list = [line.strip() for line in f]
                        log(f"✓ Loaded vocabulary: {len(vocab_list)} tokens")
                        
                        ctc_decoder = SimpleCTCBeamDecoder(
                            vocab=vocab_list,
                            lm_path=kenlm_model_path,
                            beam_width=BEAM_WIDTH,
                            alpha=LM_ALPHA,
                            beta=LM_BETA,
                            topk=BEAM_TOPK,
                            debug=DEBUG_BEAM_SEARCH
                        )
                        USE_BEAM_SEARCH = True
                        log("✅ SimpleCTCBeamDecoder initialized successfully")
                        log(f"   - Word-boundary based LM integration")
                        log(f"   - Pure Python implementation (Windows compatible)")
                        log(f"   - KenLM model: {os.path.basename(kenlm_model_path)}")
                        log(f"   - Beam width: {BEAM_WIDTH}")
                        log(f"   - Alpha (LM weight): {LM_ALPHA}")
                        log(f"   - Beta (word bonus): {LM_BETA}")
                        log(f"   - Top-K pruning: {BEAM_TOPK}")
                        if DEBUG_BEAM_SEARCH:
                            log(f"   - Debug mode: ENABLED")
                    except Exception as e:
                        log(f"Warning: Could not initialize SimpleCTC decoder: {e}")
                        import traceback
                        traceback.print_exc()
                        USE_BEAM_SEARCH = False
            else:
                if not kenlm_model_path:
                    log("[INFO] KenLM model not found at any of these paths:")
                    for path in kenlm_paths:
                        log(f"      - {path}")
                    log("      Using Greedy decoding")
                elif not HAS_KENLM:
                    log("[INFO] kenlm not available, using Greedy decoding")
                    log("      Install: pip install https://github.com/kpu/kenlm/archive/master.zip")
                USE_BEAM_SEARCH = False
        else:
            log("[INFO] Beam Search disabled in config (ENABLE_BEAM_SEARCH=False)")
            log("      Using Greedy decoding for stability")
            USE_BEAM_SEARCH = False
            
    except Exception as e:
        log(f"Warning: Could not load ASR model: {e}")
        asr_model = None
        ctc_decoder = None
        USE_BEAM_SEARCH = False
    
    # 키워드 추출 모델 로드 (Qwen3-1.7B)
    try:
        # 로컬 모델 파일 존재 여부 확인
        model_files = ['pytorch_model.bin', 'model.safetensors']
        has_model_weights = False
        
        if os.path.exists(KEYWORD_MODEL_PATH):
            # 실제 모델 가중치 파일이 있는지 확인
            has_model_weights = any(
                os.path.exists(os.path.join(KEYWORD_MODEL_PATH, f)) 
                for f in model_files
            )
        
        if has_model_weights:
            # 로컬 모델 사용
            keyword_model_path = KEYWORD_MODEL_PATH
            log(f"Loading keyword extraction model from local: {KEYWORD_MODEL_PATH}")
        else:
            # HuggingFace에서 다운로드 (Qwen3-1.7B 사용)
            keyword_model_path = "Qwen/Qwen3-1.7B"
            log(f"Local model weights not found. Downloading from HuggingFace: {keyword_model_path}")
            log(f"  Note: First download will take 5-10 minutes (~1.7GB)")
        
        keyword_tokenizer = AutoTokenizer.from_pretrained(keyword_model_path)
        keyword_model = AutoModelForCausalLM.from_pretrained(
            keyword_model_path,
            torch_dtype="auto",
            device_map="auto"
        )
        log("✓ Keyword extraction model loaded successfully")
        log(f"  - Model source: {'Local' if has_model_weights else 'HuggingFace'}")
        log(f"  - Model path: {keyword_model_path}")
    except Exception as e:
        log(f"Warning: Could not load keyword model: {e}")
        keyword_model = None
        keyword_tokenizer = None
    
    log("All models loaded and ready!")

@app.route("/", methods=["GET"])
def index():
    return "OK", 200

@app.route('/twiml', methods=['GET', 'POST'])
def return_twiml():
    from flask import request
    print("POST TwiML")
    
    # Twilio에서 전달하는 요청 파라미터 추출
    from_number = request.values.get('From', 'Unknown')
    to_number = request.values.get('To', 'Unknown')
    call_sid = request.values.get('CallSid', 'Unknown')
    
    log(f"TwiML 요청 받음 - From: {from_number}, To: {to_number}, CallSid: {call_sid}")
    
    # 템플릿에 파라미터 전달
    return render_template('streams.xml', From=from_number, To=to_number, CallSid=call_sid)

@sock.route("/stream")
def echo(ws):
    log("Connection accepted")
    count = 0
    has_seen_media = False
    
    # 통화 정보 저장 객체
    call_info = {
        'from_number': None,
        'to_number': None,
        'call_sid': None,
        'stream_sid': None,
        'timestamp': datetime.now().strftime("%Y%m%d_%H%M%S")
    }
    
    # 화자별 이중 버퍼 구조
    buffers = {
        'inbound': {  # 고객
            'audio': [],           # 저장용 버퍼
            'processing': [],      # 실시간 처리용 버퍼
            'transcriptions': [],  # 전사 결과
            'keywords': []         # 추출된 키워드
        },
        'outbound': {  # 상담사
            'audio': [],
            'processing': [],
            'transcriptions': [],
            'keywords': []
        }
    }
    
    # 처리 파라미터
    CHUNK_SIZE = int(SAMPLE_RATE_INPUT * CHUNK_DURATION)  # 샘플 수
    OVERLAP_SIZE = int(CHUNK_SIZE * CHUNK_OVERLAP)  # 오버랩 샘플 수
    
    # 화자 라벨 매핑
    speaker_labels = {
        'inbound': '고객',
        'outbound': '상담사'
    }
    
    while True:
        try:
            message = ws.receive()
            if message is None:
                log("No message received...")
                break
            
            data = json.loads(message)
            
            if data['event'] == "connected":
                log("Connected Message received")
                
            if data['event'] == "start":
                log("Start Message received")
                
                # 디버깅: start 이벤트의 전체 데이터 구조 출력
                log("DEBUG - Full start event data:")
                log(json.dumps(data, indent=2, ensure_ascii=False))
                
                # 통화 정보 추출
                start_data = data.get('start', {})
                call_info['stream_sid'] = start_data.get('streamSid')
                call_info['call_sid'] = start_data.get('callSid')
                
                # 전화번호 추출 (customParameters 또는 직접 필드에서)
                custom_params = start_data.get('customParameters', {})
                call_info['from_number'] = custom_params.get('From') or start_data.get('from')
                call_info['to_number'] = custom_params.get('To') or start_data.get('to')
                
                # 전화번호 출력 (1회만)
                log("=" * 60)
                log("📞 통화 정보")
                log("=" * 60)
                if call_info['from_number']:
                    log(f"발신 번호 (From): {call_info['from_number']}")
                if call_info['to_number']:
                    log(f"수신 번호 (To): {call_info['to_number']}")
                if call_info['call_sid']:
                    log(f"통화 ID (Call SID): {call_info['call_sid']}")
                if call_info['stream_sid']:
                    log(f"스트림 ID (Stream SID): {call_info['stream_sid']}")
                log("=" * 60)
                
                # MainBackend 통화 시작 알림
                notify_call_start(call_info)
                
                log("Starting real-time dual-track Denoise + STT processing...")
                log("Track: inbound (고객) / outbound (상담사)")
                
            if data['event'] == "media":
                if not has_seen_media:
                    log("Media messages received - processing started")
                    has_seen_media = True
                
                # track 필드로 화자 구분
                track = data['media'].get('track', 'inbound_track')
                
                # 디버깅: track 값 확인 (처음 몇 개만 출력)
                if count < 5:
                    log(f"DEBUG: Received track value: '{track}'")
                
                # track 값에 따라 화자 구분
                if 'inbound' in track.lower():
                    speaker = 'inbound'
                elif 'outbound' in track.lower():
                    speaker = 'outbound'
                else:
                    # 기본값은 inbound로 설정
                    speaker = 'inbound'
                    if count < 5:
                        log(f"WARNING: Unknown track value '{track}', defaulting to inbound")
                
                # base64 디코딩
                payload = data['media']['payload']
                audio_data = base64.b64decode(payload)
                
                # mu-law를 PCM으로 변환 (8bit mu-law -> 16bit PCM)
                pcm_data = audioop.ulaw2lin(audio_data, 2)
                
                # 해당 화자의 버퍼에 추가
                buffers[speaker]['audio'].append(pcm_data)
                buffers[speaker]['processing'].append(pcm_data)
                
                # 버퍼가 충분히 쌓이면 처리
                current_size = sum(len(chunk) for chunk in buffers[speaker]['processing'])
                if current_size >= CHUNK_SIZE * 2:  # 16-bit = 2 bytes per sample
                    # 실시간 처리
                    try:
                        transcription = process_audio_chunk(
                            buffers[speaker]['processing'], 
                            SAMPLE_RATE_INPUT, 
                            SAMPLE_RATE_TARGET
                        )
                        
                        # 빈 문자열, 너무 짧은 결과, 반복되는 단일 음절 필터링
                        if transcription and len(transcription.strip()) > 1:
                            # 단일 음절 필터링 (예: "오", "음", "아")
                            single_syllables = ['오', '음', '아', '어', '으', '이', '에', '와', '하']
                            is_single_syllable = any(
                                transcription.strip() == syllable for syllable in single_syllables
                            )
                            
                            # 중복 체크 추가 (오버랩으로 인한 반복 제거)
                            is_duplicate = is_duplicate_transcription(
                                transcription,
                                buffers[speaker]['transcriptions'],
                                similarity_threshold=0.7  # 70% 이상 유사하면 중복으로 판단
                            )
                            
                            if not is_single_syllable and not is_duplicate:
                                buffers[speaker]['transcriptions'].append(transcription)
                                log(f"[{speaker_labels[speaker]}] Transcription: {transcription}")
                                
                                # 키워드 추출
                                keywords = extract_keywords(transcription)
                                if keywords:
                                    buffers[speaker]['keywords'].extend(keywords)
                                    log(f"[{speaker_labels[speaker]}] 🔑 Keywords: {keywords}")
                                
                                # MainBackend 전송
                                send_transcription_to_mainbackend(
                                    call_info.get('call_sid'),
                                    speaker,
                                    transcription,
                                    keywords
                                )
                    except Exception as e:
                        log(f"[{speaker_labels[speaker]}] Error processing chunk: {e}")
                    
                    # 오버랩을 위해 마지막 CHUNK_OVERLAP 비율만큼 유지
                    total_bytes = sum(len(chunk) for chunk in buffers[speaker]['processing'])
                    keep_bytes = int(total_bytes * CHUNK_OVERLAP)
                    
                    if keep_bytes > 0:
                        # 뒤에서부터 keep_bytes만큼 유지
                        temp_buffer = []
                        accumulated = 0
                        for chunk in reversed(buffers[speaker]['processing']):
                            if accumulated >= keep_bytes:
                                break
                            temp_buffer.insert(0, chunk)
                            accumulated += len(chunk)
                        buffers[speaker]['processing'] = temp_buffer
                    else:
                        buffers[speaker]['processing'] = []
                
            if data['event'] == "closed":
                log("Closed Message received")
                # MainBackend 통화 종료 알림
                notify_call_end(call_info.get('call_sid'))
                break
                
            count += 1
            
        except Exception as e:
            log(f"Error: {e}")
            import traceback
            traceback.print_exc()
            break

    log(f"Connection closed. Received a total of {count} messages")
    
    # 남은 버퍼 처리 (양쪽 화자 모두)
    for speaker in ['inbound', 'outbound']:
        if buffers[speaker]['processing']:
            try:
                transcription = process_audio_chunk(
                    buffers[speaker]['processing'], 
                    SAMPLE_RATE_INPUT, 
                    SAMPLE_RATE_TARGET
                )
                if transcription:
                    # 마지막 청크도 중복 체크 적용
                    is_duplicate = is_duplicate_transcription(
                        transcription,
                        buffers[speaker]['transcriptions'],
                        similarity_threshold=0.7
                    )
                    
                    if not is_duplicate:
                        buffers[speaker]['transcriptions'].append(transcription)
                        log(f"[{speaker_labels[speaker]}] Final transcription: {transcription}")
                        
                        # 마지막 키워드 추출
                        keywords = extract_keywords(transcription)
                        if keywords:
                            buffers[speaker]['keywords'].extend(keywords)
                            log(f"[{speaker_labels[speaker]}] 🔑 Keywords: {keywords}")
            except Exception as e:
                log(f"[{speaker_labels[speaker]}] Error processing final chunk: {e}")
    
    # 화자별 파일 저장
    save_dual_track_results(buffers, speaker_labels, call_info)

def extract_keywords(text):
    """
    Qwen3-1.7B를 사용하여 한국어 문장에서 키워드 추출
    
    Args:
        text: 키워드를 추출할 한국어 문장
        
    Returns:
        list: 추출된 키워드 리스트
    """
    if not text or not text.strip() or keyword_model is None or keyword_tokenizer is None:
        return []
    
    try:
        system_prompt = (
            "당신은 한국어 한 문장에서 검색/분류에 유의미한 핵심 키워드만 추출합니다.\n"
            "규칙:\n"
            "- 키워드는 고유명사, 기술명, 개념, 객체 중심\n"
            "- 감정, 추임새, 일반적인 말은 제외\n"
            "- 키워드가 필요 없으면 반드시 빈 배열을 반환\n"
            "- 출력은 반드시 JSON 한 줄로만: {\"keywords\": [..]}\n"
            "- 추론 과정, 설명, 추가 문장 금지\n"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"문장: {text}"}
        ]

        text_input = keyword_tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False
        )

        model_inputs = keyword_tokenizer([text_input], return_tensors="pt").to(keyword_model.device)

        generated_ids = keyword_model.generate(
            **model_inputs,
            max_new_tokens=128,
            min_new_tokens=5,
            do_sample=True,
            temperature=0.7,
            top_p=0.8,
            top_k=20,
            pad_token_id=keyword_tokenizer.eos_token_id
        )

        output_ids = generated_ids[0][len(model_inputs.input_ids[0]):]
        decoded_text = keyword_tokenizer.decode(output_ids, skip_special_tokens=True).strip()

        # think 태그 제거
        decoded_text = re.sub(r'<think>.*?</think>', '', decoded_text, flags=re.DOTALL).strip()

        # JSON 추출
        m = re.search(r'\{.*\}', decoded_text, flags=re.DOTALL)
        if not m:
            return []

        result = json.loads(m.group(0))
        return result.get('keywords', [])
        
    except Exception as e:
        log(f"Error in extract_keywords: {e}")
        return []

def is_duplicate_transcription(new_text, recent_texts, similarity_threshold=0.7):
    """
    이전 전사 결과와 유사도를 체크하여 중복 여부 판단
    
    Args:
        new_text: 새로운 전사 결과
        recent_texts: 최근 전사 결과 리스트
        similarity_threshold: 유사도 임계값 (0.0~1.0)
        
    Returns:
        bool: 중복이면 True, 아니면 False
    """
    from difflib import SequenceMatcher
    
    if not new_text or not recent_texts:
        return False
    
    # 최근 3개의 전사 결과와만 비교 (효율성)
    for prev_text in recent_texts[-3:]:
        if not prev_text:
            continue
        
        # 유사도 계산
        similarity = SequenceMatcher(None, new_text.strip(), prev_text.strip()).ratio()
        
        # 임계값 이상이면 중복으로 판단
        if similarity > similarity_threshold:
            return True
    
    return False

def process_audio_chunk(buffer, input_sr, target_sr):
    """오디오 청크를 Denoise + STT 처리"""
    try:
        # 버퍼를 numpy 배열로 변환
        audio_data = b''.join(buffer)
        audio_np = np.frombuffer(audio_data, dtype=np.int16).astype(np.float32) / 32768.0
        
        # 오디오 길이 체크 (너무 짧으면 스킵)
        duration = len(audio_np) / input_sr
        if duration < MIN_AUDIO_LENGTH:
            return None
        
        # 음성 에너지 체크 (너무 조용하면 스킵)
        rms_energy = np.sqrt(np.mean(audio_np**2))
        if rms_energy < MIN_ENERGY_THRESHOLD:
            return None
        
        # 오디오 정규화 (볼륨 균일화)
        if AUDIO_NORMALIZATION:
            max_amp = np.max(np.abs(audio_np))
            if max_amp > 0:
                audio_np = audio_np / max_amp
        
        # 리샘플링 (8kHz -> 16kHz)
        if input_sr != target_sr:
            audio_resampled = librosa.resample(audio_np, orig_sr=input_sr, target_sr=target_sr)
        else:
            audio_resampled = audio_np
        
        # Denoise
        if denoiser_model is not None:
            audio_tensor = torch.tensor(audio_resampled).unsqueeze(0).unsqueeze(0).to(device)
            with torch.no_grad():
                audio_denoised = denoiser_model(audio_tensor)
            audio_denoised = audio_denoised.squeeze().cpu().numpy()
        else:
            audio_denoised = audio_resampled
        
        # STT
        if asr_model is not None:
            with torch.no_grad():
                if USE_BEAM_SEARCH:
                    if BEAM_DECODER_MODE == "nemo":
                        # NeMo 공식 BeamCTCDecoder 사용
                        try:
                            # transcribe with beam search
                            transcription = asr_model.transcribe([audio_denoised], batch_size=1)
                            if transcription and len(transcription) > 0:
                                result = transcription[0]
                                if hasattr(result, 'text'):
                                    text = result.text
                                else:
                                    text = str(result)
                                
                                if text:
                                    text = unicodedata.normalize('NFC', text)
                                    # 후처리: 반복 문자 제거
                                    text = re.sub(r'(.)\1{2,}', r'\1\1', text)
                                    return text.strip()
                        except Exception as e:
                            log(f"NeMo Beam Search failed, falling back to Greedy: {e}")
                    
                    elif BEAM_DECODER_MODE == "simple" and ctc_decoder is not None:
                        # SimpleCTCBeamDecoder 사용
                        try:
                            # audio를 tensor로 변환
                            audio_tensor = torch.tensor(audio_denoised).unsqueeze(0).to(device)
                            audio_length = torch.tensor([audio_tensor.shape[1]]).to(device)
                            
                            # NeMo 모델에서 logits 추출
                            processed_signal, processed_signal_length = asr_model.preprocessor(
                                input_signal=audio_tensor, length=audio_length
                            )
                            if asr_model.spec_augmentation is not None and asr_model.training:
                                processed_signal = asr_model.spec_augmentation(
                                    input_spec=processed_signal, length=processed_signal_length
                                )
                            encoded, encoded_len = asr_model.encoder(
                                audio_signal=processed_signal, length=processed_signal_length
                            )
                            log_probs = asr_model.decoder(encoder_output=encoded)
                            
                            # SimpleCTCBeamDecoder로 디코딩
                            # log_probs shape: [batch=1, time, vocab]
                            logits_np = log_probs[0].cpu().numpy()  # [time, vocab]
                            text = ctc_decoder.decode(logits_np)
                            
                            if text:
                                text = unicodedata.normalize('NFC', text)
                                # 후처리: 반복 문자 제거
                                text = re.sub(r'(.)\1{2,}', r'\1\1', text)
                                return text.strip()
                        except Exception as e:
                            log(f"SimpleCTC Beam Search failed, falling back to Greedy: {e}")
                
                # Greedy 디코딩 (기본 또는 폴백)
                # ASR 모델의 decoding strategy를 임시로 greedy로 변경
                original_strategy = None
                try:
                    if hasattr(asr_model, 'cfg') and hasattr(asr_model.cfg, 'decoding'):
                        original_strategy = asr_model.cfg.decoding.strategy
                        asr_model.change_decoding_strategy(None)  # Reset to greedy
                except:
                    pass
                
                transcription = asr_model.transcribe([audio_denoised], batch_size=1)
                
                # 원래 strategy 복구
                if original_strategy and USE_BEAM_SEARCH and BEAM_DECODER_MODE == "nemo":
                    try:
                        asr_model.change_decoding_strategy(asr_model.cfg.decoding)
                    except:
                        pass
                
                if transcription and len(transcription) > 0:
                    # Hypothesis 객체에서 text 속성 추출
                    result = transcription[0]
                    if hasattr(result, 'text'):
                        text = result.text
                    else:
                        text = str(result)
                    
                    if text:
                        text = unicodedata.normalize('NFC', text)
                        # 후처리: 반복 문자 제거 (예: "오오오" → "오오")
                        text = re.sub(r'(.)\1{2,}', r'\1\1', text)
                        return text.strip()
        
        return None
        
    except Exception as e:
        log(f"Error in process_audio_chunk: {e}")
        import traceback
        traceback.print_exc()
        return None

def save_dual_track_results(buffers, speaker_labels, call_info):
    """화자별 오디오, 전사 결과, 키워드 저장"""
    try:
        # 타임스탬프 기반 파일명 (call_info에서 가져오기)
        timestamp = call_info.get('timestamp', datetime.now().strftime("%Y%m%d_%H%M%S"))
        os.makedirs(RECORDINGS_DIR, exist_ok=True)
        
        # 파일명 매핑
        file_suffixes = {
            'inbound': 'customer',   # 고객
            'outbound': 'agent'      # 상담사
        }
        
        total_duration = 0
        stats = {}
        
        # 각 화자별로 파일 저장
        for speaker in ['inbound', 'outbound']:
            suffix = file_suffixes[speaker]
            label = speaker_labels[speaker]
            
            # 오디오 데이터가 있는 경우에만 저장
            if buffers[speaker]['audio']:
                # WAV 파일 저장
                audio_filename = os.path.join(RECORDINGS_DIR, f"call_{timestamp}_{suffix}.wav")
                audio_data = b''.join(buffers[speaker]['audio'])
                
                with wave.open(audio_filename, 'wb') as wav_file:
                    wav_file.setnchannels(1)
                    wav_file.setsampwidth(2)
                    wav_file.setframerate(SAMPLE_RATE_INPUT)
                    wav_file.writeframes(audio_data)
                
                duration = len(audio_data) / (SAMPLE_RATE_INPUT * 2)
                total_duration = max(total_duration, duration)
                log(f"[{label}] Audio saved: {audio_filename}")
                log(f"[{label}] Duration: {duration:.2f} seconds")
                
                # 통계 저장
                stats[speaker] = {
                    'audio_file': audio_filename,
                    'duration': duration,
                    'chunks': len(buffers[speaker]['audio'])
                }
            
            # 전사 결과 및 키워드 저장
            if buffers[speaker]['transcriptions']:
                txt_filename = os.path.join(RECORDINGS_DIR, f"call_{timestamp}_{suffix}.txt")
                with open(txt_filename, 'w', encoding='utf-8') as f:
                    # 통화 정보 헤더
                    f.write("=" * 60 + "\n")
                    f.write("통화 정보\n")
                    f.write("=" * 60 + "\n")
                    if call_info.get('from_number'):
                        f.write(f"발신 번호: {call_info['from_number']}\n")
                    if call_info.get('to_number'):
                        f.write(f"수신 번호: {call_info['to_number']}\n")
                    if call_info.get('call_sid'):
                        f.write(f"통화 ID: {call_info['call_sid']}\n")
                    if call_info.get('stream_sid'):
                        f.write(f"스트림 ID: {call_info['stream_sid']}\n")
                    f.write(f"저장 시각: {timestamp}\n")
                    f.write("=" * 60 + "\n\n")
                    
                    f.write(f"=== 화자: {label} ({speaker.capitalize()} Track) ===\n\n")
                    
                    f.write("=== Real-time Transcription Results ===\n\n")
                    for i, trans in enumerate(buffers[speaker]['transcriptions'], 1):
                        f.write(f"[Chunk {i}] {trans}\n")
                    
                    f.write("\n=== Full Transcription ===\n")
                    full_text = " ".join(buffers[speaker]['transcriptions'])
                    f.write(full_text)
                    
                    # 키워드 추가
                    if buffers[speaker]['keywords']:
                        f.write("\n\n=== Extracted Keywords ===\n")
                        unique_keywords = list(set(buffers[speaker]['keywords']))
                        f.write(f"Total unique keywords: {len(unique_keywords)}\n")
                        f.write(f"Keywords: {', '.join(unique_keywords)}\n")
                
                log(f"[{label}] Transcription saved: {txt_filename}")
                log(f"[{label}] Total chunks transcribed: {len(buffers[speaker]['transcriptions'])}")
                
                if buffers[speaker]['keywords']:
                    unique_keywords = list(set(buffers[speaker]['keywords']))
                    log(f"[{label}] Extracted {len(unique_keywords)} unique keywords: {unique_keywords}")
                
                # 통계 업데이트
                if speaker in stats:
                    stats[speaker]['txt_file'] = txt_filename
                    stats[speaker]['transcriptions'] = len(buffers[speaker]['transcriptions'])
                    stats[speaker]['keywords'] = len(unique_keywords) if buffers[speaker]['keywords'] else 0
        
        # 전체 통화 요약
        log("\n=== Call Summary ===")
        log(f"Total call duration: {total_duration:.2f} seconds")
        for speaker in ['inbound', 'outbound']:
            if speaker in stats:
                label = speaker_labels[speaker]
                log(f"[{label}] Chunks: {stats[speaker].get('chunks', 0)}, "
                    f"Transcriptions: {stats[speaker].get('transcriptions', 0)}, "
                    f"Keywords: {stats[speaker].get('keywords', 0)}")
        
    except Exception as e:
        log(f"Error saving results: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    # 모델 로드
    load_models()
    
    # 서버 시작
    log("Starting server...")
    log(f"Server will listen on port {HTTP_SERVER_PORT}")
    app.run(host='0.0.0.0', port=HTTP_SERVER_PORT, debug=True, use_reloader=False)
