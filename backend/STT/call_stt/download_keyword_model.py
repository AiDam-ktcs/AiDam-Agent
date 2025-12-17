#!/usr/bin/env python3
"""
HuggingFace에서 키워드 추출 모델을 다운로드하여 로컬에 저장하는 스크립트

사용법:
    python download_keyword_model.py

설명:
    - Qwen/Qwen2.5-1.5B 모델을 HuggingFace에서 다운로드
    - backend/STT/models/qwen3-1.7b 폴더에 저장
    - 약 3GB 다운로드 (인터넷 속도에 따라 5-10분 소요)
"""

import os
import sys
from pathlib import Path

# 프로젝트 루트 경로
SCRIPT_DIR = Path(__file__).parent
BASE_DIR = SCRIPT_DIR.parent
MODELS_DIR = BASE_DIR / 'models'
TARGET_MODEL_DIR = MODELS_DIR / 'qwen3-1.7b'

# HuggingFace 모델 ID
HUGGINGFACE_MODEL_ID = "Qwen/Qwen3-1.7B"

def print_header():
    """헤더 출력"""
    print("=" * 70)
    print("🤖 Keyword Extraction Model Downloader")
    print("=" * 70)
    print(f"Model: {HUGGINGFACE_MODEL_ID}")
    print(f"Target Directory: {TARGET_MODEL_DIR}")
    print(f"Expected Size: ~3GB")
    print("=" * 70)
    print()

def check_existing_model():
    """이미 모델이 있는지 확인"""
    model_files = ['pytorch_model.bin', 'model.safetensors']
    
    if TARGET_MODEL_DIR.exists():
        for model_file in model_files:
            if (TARGET_MODEL_DIR / model_file).exists():
                print(f"✓ Model already exists: {TARGET_MODEL_DIR / model_file}")
                return True
    
    return False

def download_model():
    """HuggingFace에서 모델 다운로드"""
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        
        print(f"📥 Downloading model from HuggingFace: {HUGGINGFACE_MODEL_ID}")
        print("   This may take 5-10 minutes depending on your internet speed...")
        print()
        
        # models 디렉토리 생성
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        
        # 토크나이저 다운로드 및 저장
        print("1/2 Downloading tokenizer...")
        tokenizer = AutoTokenizer.from_pretrained(HUGGINGFACE_MODEL_ID)
        tokenizer.save_pretrained(TARGET_MODEL_DIR)
        print("✓ Tokenizer saved successfully")
        print()
        
        # 모델 다운로드 및 저장
        print("2/2 Downloading model (this will take a few minutes)...")
        model = AutoModelForCausalLM.from_pretrained(
            HUGGINGFACE_MODEL_ID,
            torch_dtype="auto",
            device_map="auto"
        )
        model.save_pretrained(TARGET_MODEL_DIR)
        print("✓ Model saved successfully")
        print()
        
        return True
        
    except ImportError as e:
        print("❌ Error: Required packages not installed")
        print("   Please install transformers and torch:")
        print("   pip install transformers torch")
        print()
        print(f"   Details: {e}")
        return False
        
    except Exception as e:
        print(f"❌ Error downloading model: {e}")
        import traceback
        traceback.print_exc()
        return False

def verify_download():
    """다운로드 확인"""
    print("\n" + "=" * 70)
    print("📂 Verifying downloaded files...")
    print("=" * 70)
    
    required_files = [
        'config.json',
        'tokenizer.json',
        'vocab.json',
        'merges.txt',
    ]
    
    model_weight_files = ['pytorch_model.bin', 'model.safetensors']
    
    all_good = True
    
    # 필수 파일 확인
    for file_name in required_files:
        file_path = TARGET_MODEL_DIR / file_name
        if file_path.exists():
            size = file_path.stat().st_size / (1024 * 1024)  # MB
            print(f"✓ {file_name:<30} ({size:.2f} MB)")
        else:
            print(f"✗ {file_name:<30} (MISSING)")
            all_good = False
    
    # 모델 가중치 파일 확인 (둘 중 하나만 있어도 됨)
    has_model_weights = False
    for file_name in model_weight_files:
        file_path = TARGET_MODEL_DIR / file_name
        if file_path.exists():
            size = file_path.stat().st_size / (1024 * 1024 * 1024)  # GB
            print(f"✓ {file_name:<30} ({size:.2f} GB)")
            has_model_weights = True
    
    if not has_model_weights:
        print(f"✗ Model weights (pytorch_model.bin or model.safetensors) (MISSING)")
        all_good = False
    
    print("=" * 70)
    
    if all_good:
        print("\n✅ All files downloaded successfully!")
        print(f"\n📁 Model saved to: {TARGET_MODEL_DIR}")
        print("\n🚀 You can now run the STT server:")
        print("   cd backend/STT/call_stt")
        print("   python server5.py")
    else:
        print("\n⚠️  Some files are missing. Please try downloading again.")
    
    print()
    return all_good

def main():
    """메인 함수"""
    print_header()
    
    # 이미 모델이 있는지 확인
    if check_existing_model():
        print("\n⚠️  Model already exists!")
        response = input("Do you want to re-download? (y/N): ").strip().lower()
        if response != 'y':
            print("Skipping download.")
            return 0
        print()
    
    # 모델 다운로드
    success = download_model()
    
    if not success:
        return 1
    
    # 다운로드 확인
    verify_download()
    
    return 0

if __name__ == '__main__':
    try:
        exit_code = main()
        sys.exit(exit_code)
    except KeyboardInterrupt:
        print("\n\n⚠️  Download interrupted by user.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

