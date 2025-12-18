# Twilio 쌍방향 통화 스트리밍 설정

import os
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

# 프로젝트 루트 경로
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 환경변수에서 로드 (민감한 정보)
# .env 파일에 설정하거나, 기본값 사용
AGENT_PHONE_NUMBER = os.getenv('AGENT_PHONE_NUMBER', '+821012345678')
WEBSOCKET_URL = os.getenv('WEBSOCKET_URL', 'wss://your-ngrok-url.ngrok-free.dev/stream')

# 서버 설정
HTTP_SERVER_PORT = int(os.getenv('HTTP_SERVER_PORT', '5000'))

# 오디오 처리 설정
SAMPLE_RATE_INPUT = 8000    # Twilio 입력 샘플레이트
SAMPLE_RATE_TARGET = 16000  # ASR 모델 요구 샘플레이트
CHUNK_DURATION = 4.0        # 처리 단위 (초) - 더 긴 문맥으로 인식 품질 향상
CHUNK_OVERLAP = 0.2         # 청크 오버랩 비율 (0.2 = 20% 중복) - 중복 감소

# STT 품질 개선 설정
MIN_AUDIO_LENGTH = 0.3      # 최소 오디오 길이 (초) - 너무 짧은 소리 필터링
MIN_ENERGY_THRESHOLD = 0.01 # 최소 음성 에너지 임계값
AUDIO_NORMALIZATION = True  # 오디오 정규화 활성화
DENOISE_DRY_MIX = 0.02      # Denoiser dry mix (낮을수록 강한 노이즈 제거)

# Beam Search 파라미터 (단어 경계 기반 LM 적용)
# KenLM 언어 모델과 함께 Beam Search를 사용하여 인식 정확도 향상
ENABLE_BEAM_SEARCH = True  # True: Beam Search + KenLM, False: Greedy (안정적)
BEAM_DECODER_TYPE = "nemo" # "nemo": NeMo 공식 decoder, "simple": SimpleCTC decoder
BEAM_WIDTH = 64             # Beam 크기 (더 많은 후보 탐색)
LM_ALPHA = 0.5              # 언어 모델 가중치 (BPE 특성상 낮은 값이 효과적)
LM_BETA = 0.1               # 단어 삽입 보너스 (단어 완성 시 적용)
BEAM_TOPK = 100             # 각 타임스텝에서 고려할 상위 토큰 수 (속도 최적화)

# Beam Search 디버깅 모드
DEBUG_BEAM_SEARCH = False   # True로 설정 시 상세 로깅 (단어 조합, LM 스코어 등)

# 모델 경로 (프로젝트 루트 기준 상대 경로)
DENOISER_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'denoiser.th')
ASR_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'Conformer-CTC-BPE.nemo')
KEYWORD_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'qwen3-1.7b')

# KenLM 언어 모델 경로 (선택사항)
# 파일이 있으면 Beam Search + LM, 없으면 Beam Search만 사용
KENLM_MODEL_PATH = os.path.join(BASE_DIR, 'models', 'korean_lm.bin')
# 또는 42MARU 모델 사용: os.path.join(BASE_DIR, 'models', 'korean_lm_42maru.bin')

# 녹음 파일 저장 경로
RECORDINGS_DIR = os.path.join(BASE_DIR, 'call_recordings')

# MainBackend 연동 설정
MAINBACKEND_URL = os.getenv('MAINBACKEND_URL', 'http://localhost:3000')
MAINBACKEND_ENABLED = os.getenv('MAINBACKEND_ENABLED', 'true').lower() == 'true'
MAINBACKEND_TIMEOUT = int(os.getenv('MAINBACKEND_TIMEOUT', '5'))