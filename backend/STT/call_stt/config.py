# Twilio 쌍방향 통화 스트리밍 설정

import os
from dotenv import load_dotenv

# 프로젝트 루트 경로 (backend/STT/)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# .env 파일 로드 (상위 폴더 backend/STT/.env에서 로드)
env_path = os.path.join(BASE_DIR, '.env')
load_dotenv(env_path)

# 환경변수에서 로드 (민감한 정보)
# .env 파일에 설정하거나, 기본값 사용
AGENT_PHONE_NUMBER = os.getenv('AGENT_PHONE_NUMBER', '+821012345678')

# OpenAI API 설정 (키워드 추출용)
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-5-nano')
WEBSOCKET_URL = os.getenv('WEBSOCKET_URL', 'wss://your-ngrok-url.ngrok-free.dev/stream')
DIAL_PHONE_NUMBER = os.getenv('DIAL_PHONE_NUMBER', '+821024748863')

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
ENABLE_BEAM_SEARCH = False  # True: Beam Search + KenLM, False: Greedy (안정적)
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
# WSL에서 Windows 호스트 접근: /etc/resolv.conf에서 Windows IP 가져옴
def get_default_mainbackend_url():
    """WSL 환경 감지 후 적절한 MainBackend URL 반환"""
    # 방법 1: WSL 환경변수 확인
    if os.getenv('WSL_DISTRO_NAME') or os.getenv('WSLENV'):
        pass  # WSL 환경
    # 방법 2: /proc/version 확인
    elif os.path.exists('/proc/version'):
        try:
            with open('/proc/version', 'r') as f:
                if 'microsoft' in f.read().lower():
                    pass  # WSL 환경
                else:
                    return 'http://localhost:3000'
        except:
            return 'http://localhost:3000'
    else:
        return 'http://localhost:3000'
    
    # WSL 환경: Windows 호스트 IP 가져오기
    # 방법 1: ip route로 기본 게이트웨이 확인 (가장 정확)
    try:
        import subprocess
        result = subprocess.run(
            ['sh', '-c', "ip route show | grep -i default | awk '{ print $3}'"],
            capture_output=True,
            text=True,
            timeout=2
        )
        if result.returncode == 0 and result.stdout.strip():
            host_ip = result.stdout.strip()
            print(f"[Config] WSL detected, using Windows host IP (via ip route): {host_ip}")
            return f'http://{host_ip}:3000'
    except Exception as e:
        print(f"[Config] ip route method failed: {e}")
    
    # 방법 2: /etc/resolv.conf (fallback)
    try:
        with open('/etc/resolv.conf', 'r') as f:
            for line in f:
                if 'nameserver' in line:
                    host_ip = line.split()[1]
                    # 10.255.255.254 같은 특수 IP는 피함
                    if not host_ip.startswith('10.255.'):
                        print(f"[Config] WSL detected, using Windows host IP (via resolv.conf): {host_ip}")
                        return f'http://{host_ip}:3000'
    except Exception as e:
        print(f"[Config] resolv.conf method failed: {e}")
    
    print(f"[Config] Fallback to localhost")
    return 'http://localhost:3000'

# 환경변수 확인 (localhost인 경우 자동 감지 사용)
env_url = os.getenv('MAINBACKEND_URL')
if env_url and 'localhost' not in env_url and '127.0.0.1' not in env_url:
    MAINBACKEND_URL = env_url
    print(f"[Config] Using environment variable: {MAINBACKEND_URL}")
else:
    MAINBACKEND_URL = get_default_mainbackend_url()
    print(f"[Config] Using auto-detected URL: {MAINBACKEND_URL}")

MAINBACKEND_ENABLED = os.getenv('MAINBACKEND_ENABLED', 'true').lower() == 'true'
MAINBACKEND_TIMEOUT = int(os.getenv('MAINBACKEND_TIMEOUT', '5'))