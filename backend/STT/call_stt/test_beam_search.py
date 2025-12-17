"""
Beam Search + KenLM 테스트 스크립트

저장된 WAV 파일로 Greedy vs Beam Search 성능을 비교합니다.
"""

import os
import sys
import numpy as np
import torch
import librosa
import soundfile as sf
from datetime import datetime

# 프로젝트 루트 경로 추가
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(BASE_DIR)

# Denoiser 경로 추가
denoiser_directory = os.path.join(BASE_DIR, 'src', 'denoiser')
sys.path.append(denoiser_directory)

from denoiser import pretrained
import nemo.collections.asr as nemo_asr

# KenLM import
try:
    import kenlm
    HAS_KENLM = True
except ImportError:
    HAS_KENLM = False
    print("[WARN] kenlm is not installed.")

# 설정 파일 import
from config import (
    DENOISER_MODEL_PATH,
    ASR_MODEL_PATH,
    BEAM_WIDTH,
    LM_ALPHA,
    LM_BETA,
    BEAM_TOPK,
    DEBUG_BEAM_SEARCH,
    SAMPLE_RATE_TARGET,
    DENOISE_DRY_MIX
)

# SimpleCTCBeamDecoder import
from server5 import SimpleCTCBeamDecoder

class BeamSearchTester:
    """Beam Search 테스터"""
    
    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"[INFO] Using device: {self.device}")
        
        # 모델 로드
        self.load_models()
    
    def load_models(self):
        """모델 로드"""
        print("\n[INFO] Loading models...")
        
        # Denoiser 모델
        try:
            import argparse
            denoiser_args = argparse.Namespace(
                dns64=False,
                dns48=False,
                master64=False,
                device=str(self.device),
                dry=DENOISE_DRY_MIX,
                model_path=DENOISER_MODEL_PATH
            )
            self.denoiser_model = pretrained.get_model(denoiser_args).to(self.device)
            self.denoiser_model.eval()
            print("[OK] Denoiser model loaded")
        except Exception as e:
            print(f"[WARN] Denoiser load failed: {e}")
            self.denoiser_model = None
        
        # ASR 모델
        try:
            self.asr_model = nemo_asr.models.EncDecCTCModelBPE.restore_from(
                ASR_MODEL_PATH, 
                map_location=self.device
            )
            self.asr_model.eval()
            
            # Preprocessor 설정
            from omegaconf import OmegaConf
            import copy
            asr_cfg = copy.deepcopy(self.asr_model._cfg)
            OmegaConf.set_struct(asr_cfg.preprocessor, False)
            asr_cfg.preprocessor.dither = 0.0
            asr_cfg.preprocessor.pad_to = 0
            OmegaConf.set_struct(asr_cfg.preprocessor, True)
            self.asr_model.preprocessor = self.asr_model.from_config_dict(asr_cfg.preprocessor)
            
            if self.device.type == 'cuda':
                self.asr_model.cuda()
            
            print("[OK] ASR model loaded")
        except Exception as e:
            print(f"[ERROR] ASR load failed: {e}")
            self.asr_model = None
            return
        
        # Vocabulary 로드
        try:
            vocab_path = os.path.join(BASE_DIR, 'src', 'nemo_asr', 'tokenizer_spe_bpe_v2048', 'vocab.txt')
            with open(vocab_path, 'r', encoding='utf-8') as f:
                self.vocab_list = [line.strip() for line in f]
            print(f"[OK] Vocabulary loaded: {len(self.vocab_list)} tokens")
        except Exception as e:
            print(f"[ERROR] Vocabulary load failed: {e}")
            self.vocab_list = None
            return
        
        # Beam Search Decoder 초기화
        if HAS_KENLM and self.vocab_list:
            try:
                kenlm_paths = [
                    os.path.join(BASE_DIR, 'models', 'korean_4gram.binary'),
                    os.path.join(BASE_DIR, 'models', 'korean_4gram.arpa'),
                ]
                
                kenlm_model_path = None
                for path in kenlm_paths:
                    if os.path.exists(path):
                        kenlm_model_path = path
                        break
                
                if kenlm_model_path:
                    self.beam_decoder = SimpleCTCBeamDecoder(
                        vocab=self.vocab_list,
                        lm_path=kenlm_model_path,
                        beam_width=BEAM_WIDTH,
                        alpha=LM_ALPHA,
                        beta=LM_BETA,
                        topk=BEAM_TOPK,
                        debug=True  # 테스트 시 항상 디버그 모드
                    )
                    print(f"[OK] Beam Search decoder initialized")
                    print(f"  - Model: {os.path.basename(kenlm_model_path)}")
                    print(f"  - Beam width: {BEAM_WIDTH}")
                    print(f"  - Alpha: {LM_ALPHA}, Beta: {LM_BETA}")
                    print(f"  - Top-K: {BEAM_TOPK}")
                else:
                    print("[WARN] KenLM model not found")
                    self.beam_decoder = None
            except Exception as e:
                print(f"[WARN] Beam decoder init failed: {e}")
                import traceback
                traceback.print_exc()
                self.beam_decoder = None
        else:
            print("[WARN] Beam Search not available")
            self.beam_decoder = None
    
    def load_audio(self, wav_path):
        """WAV 파일 로드 및 전처리"""
        try:
            # 오디오 로드
            audio, sr = librosa.load(wav_path, sr=SAMPLE_RATE_TARGET)
            print(f"[OK] Audio loaded: {len(audio)/sr:.2f}s @ {sr}Hz")
            
            # Denoising
            if self.denoiser_model:
                audio_tensor = torch.tensor(audio).unsqueeze(0).unsqueeze(0).to(self.device)
                with torch.no_grad():
                    audio_denoised = self.denoiser_model(audio_tensor)
                audio = audio_denoised.squeeze().cpu().numpy()
                print("[OK] Audio denoised")
            
            return audio
        except Exception as e:
            print(f"[ERROR] Audio load failed: {e}")
            return None
    
    def transcribe_greedy(self, audio):
        """Greedy 디코딩"""
        try:
            start_time = datetime.now()
            
            transcription = self.asr_model.transcribe([audio], batch_size=1)
            result = transcription[0]
            
            if hasattr(result, 'text'):
                text = result.text
            else:
                text = str(result)
            
            elapsed = (datetime.now() - start_time).total_seconds()
            
            return text, elapsed
        except Exception as e:
            print(f"[ERROR] Greedy transcription failed: {e}")
            import traceback
            traceback.print_exc()
            return None, 0
    
    def transcribe_beam_search(self, audio):
        """Beam Search 디코딩"""
        if not self.beam_decoder:
            return None, 0
        
        try:
            start_time = datetime.now()
            
            # Logits 추출
            audio_tensor = torch.tensor(audio).unsqueeze(0).to(self.device)
            audio_length = torch.tensor([audio_tensor.shape[1]]).to(self.device)
            
            with torch.no_grad():
                processed_signal, processed_signal_length = self.asr_model.preprocessor(
                    input_signal=audio_tensor, length=audio_length
                )
                encoded, encoded_len = self.asr_model.encoder(
                    audio_signal=processed_signal, length=processed_signal_length
                )
                log_probs = self.asr_model.decoder(encoder_output=encoded)
            
            # Beam Search 디코딩
            logits_np = log_probs[0].cpu().numpy()
            print(f"[DEBUG] Log probs shape: {logits_np.shape}")
            print(f"[DEBUG] Vocab size: {len(self.vocab_list)}")
            print(f"[DEBUG] Blank ID: {self.beam_decoder.blank_id}")
            text = self.beam_decoder.decode(logits_np)
            
            elapsed = (datetime.now() - start_time).total_seconds()
            
            return text, elapsed
        except Exception as e:
            print(f"[ERROR] Beam Search transcription failed: {e}")
            import traceback
            traceback.print_exc()
            return None, 0
    
    def compare_transcriptions(self, wav_path):
        """Greedy vs Beam Search 비교"""
        print(f"\n{'='*80}")
        print(f"Testing: {os.path.basename(wav_path)}")
        print(f"{'='*80}\n")
        
        # 오디오 로드
        audio = self.load_audio(wav_path)
        if audio is None:
            return
        
        # Greedy 디코딩
        print("\n[TEST] Greedy Decoding...")
        greedy_text, greedy_time = self.transcribe_greedy(audio)
        
        # Beam Search 디코딩
        print("\n[TEST] Beam Search Decoding...")
        beam_text, beam_time = self.transcribe_beam_search(audio)
        
        # 결과 출력
        print(f"\n{'='*80}")
        print("[RESULTS]")
        print(f"{'='*80}")
        
        if greedy_text:
            print(f"\n[Greedy]")
            print(f"  Text: {greedy_text}")
            print(f"  Time: {greedy_time:.3f}s")
        
        if beam_text:
            print(f"\n[Beam Search]")
            print(f"  Text: {beam_text}")
            print(f"  Time: {beam_time:.3f}s")
        
        if greedy_text and beam_text:
            print(f"\n[Comparison]")
            print(f"  Speed ratio: {beam_time/greedy_time:.2f}x")
            
            # 단순 유사도 (문자 단위)
            from difflib import SequenceMatcher
            similarity = SequenceMatcher(None, greedy_text, beam_text).ratio()
            print(f"  Similarity: {similarity*100:.1f}%")
            
            # 차이점 표시
            if similarity < 1.0:
                print(f"\n[Differences]")
                import difflib
                diff = difflib.unified_diff(
                    greedy_text.split(),
                    beam_text.split(),
                    lineterm='',
                    fromfile='Greedy',
                    tofile='Beam'
                )
                for line in diff:
                    print(f"  {line}")
        
        print(f"\n{'='*80}\n")


def main():
    """메인 테스트 함수"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Beam Search 테스트')
    parser.add_argument('--wav', type=str, help='WAV 파일 경로')
    parser.add_argument('--recordings-dir', type=str, 
                       default=os.path.join(BASE_DIR, 'call_recordings'),
                       help='녹음 파일 디렉토리')
    parser.add_argument('--latest', action='store_true',
                       help='최신 customer.wav 파일 테스트')
    
    args = parser.parse_args()
    
    # 테스터 초기화
    tester = BeamSearchTester()
    
    if not tester.asr_model:
        print("[ERROR] ASR model not loaded. Exiting.")
        return
    
    # 테스트할 WAV 파일 결정
    wav_files = []
    
    if args.wav:
        wav_files.append(args.wav)
    elif args.latest:
        # 최신 customer.wav 찾기
        recordings_dir = args.recordings_dir
        if os.path.exists(recordings_dir):
            customer_files = [f for f in os.listdir(recordings_dir) 
                            if f.endswith('_customer.wav')]
            if customer_files:
                customer_files.sort(reverse=True)
                wav_files.append(os.path.join(recordings_dir, customer_files[0]))
            else:
                print(f"[ERROR] No customer.wav files found in {recordings_dir}")
                return
        else:
            print(f"[ERROR] Directory not found: {recordings_dir}")
            return
    else:
        # 기본: 모든 customer.wav 테스트
        recordings_dir = args.recordings_dir
        if os.path.exists(recordings_dir):
            customer_files = [f for f in os.listdir(recordings_dir) 
                            if f.endswith('_customer.wav')]
            customer_files.sort(reverse=True)
            wav_files = [os.path.join(recordings_dir, f) for f in customer_files[:3]]
        else:
            print(f"[ERROR] Directory not found: {recordings_dir}")
            return
    
    if not wav_files:
        print("[ERROR] No WAV files to test")
        print("Usage:")
        print("  python test_beam_search.py --latest")
        print("  python test_beam_search.py --wav path/to/file.wav")
        return
    
    # 테스트 실행
    for wav_file in wav_files:
        tester.compare_transcriptions(wav_file)


if __name__ == '__main__':
    main()

