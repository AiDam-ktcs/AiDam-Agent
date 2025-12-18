import requests
import time
import sys

BASE_URL = "http://localhost:3000"

# 딜레이 설정 (초) - 각 메시지 사이 간격
DELAY = 2.0

print("=" * 50)
print("  키워드 실시간 테스트")
print("  - 브라우저에서 통화 목록을 열어두세요!")
print("  - 메시지가 하나씩 전송됩니다")
print("=" * 50)

# 통화 시작
print("\n[1] 통화 시작...")
res = requests.post(f"{BASE_URL}/api/stt/call-start", json={
    "callId": "kw-realtime-test",
    "phoneNumber": "010-1234-5678",
    "timestamp": "2025-12-17T18:00:00Z"
})
print(f"    -> {res.status_code}")

print(f"\n[!] 브라우저에서 'kw-realtime-test' 통화를 선택하세요!")
print(f"[!] 3초 후 메시지 전송 시작...\n")
time.sleep(3)

# 메시지들 (다양한 키워드 빈도로 구성)
messages = [
    # 요금제: 5회
    {"speaker": "customer", "text": "요금제 변경하고 싶어요", "keywords": ["요금제", "변경"]},
    {"speaker": "customer", "text": "요금제 추천해주세요", "keywords": ["요금제", "추천"]},
    {"speaker": "customer", "text": "요금제 종류가 뭐가 있어요?", "keywords": ["요금제", "종류"]},
    {"speaker": "customer", "text": "요금제 비교해주세요", "keywords": ["요금제", "비교"]},
    {"speaker": "customer", "text": "요금제 혜택이 뭐에요?", "keywords": ["요금제", "혜택"]},
    
    # 데이터: 4회
    {"speaker": "customer", "text": "데이터가 부족해요", "keywords": ["데이터", "부족"]},
    {"speaker": "customer", "text": "데이터 무제한 있나요?", "keywords": ["데이터", "무제한"]},
    {"speaker": "customer", "text": "데이터 사용량 확인하고 싶어요", "keywords": ["데이터", "사용량"]},
    {"speaker": "customer", "text": "데이터 추가하려면요?", "keywords": ["데이터", "추가"]},
    
    # 해지: 3회
    {"speaker": "customer", "text": "해지하고 싶어요", "keywords": ["해지"]},
    {"speaker": "customer", "text": "해지 위약금이요?", "keywords": ["해지", "위약금"]},
    {"speaker": "customer", "text": "해지 절차가 어떻게 되나요?", "keywords": ["해지", "절차"]},
    
    # 할인: 2회
    {"speaker": "customer", "text": "할인 받을 수 있나요?", "keywords": ["할인"]},
    {"speaker": "customer", "text": "할인 혜택 알려주세요", "keywords": ["할인", "혜택"]},
    
    # 로밍: 1회
    {"speaker": "customer", "text": "해외 로밍 사용하려면요?", "keywords": ["로밍", "해외"]},
]

print("[2] 메시지 전송 시작!")
print("-" * 50)

for i, msg in enumerate(messages):
    # 메시지 전송
    res = requests.post(f"{BASE_URL}/api/stt/line", json={
        "callId": "kw-realtime-test",
        **msg
    })
    
    # 현재 상태 출력
    keywords_str = ", ".join(msg["keywords"])
    print(f"[{i+1:2d}/{len(messages)}] \"{msg['text']}\"")
    print(f"         -> 키워드: {keywords_str}")
    
    if i < len(messages) - 1:
        print(f"         (다음 메시지까지 {DELAY}초...)")
        time.sleep(DELAY)
    
    print()

print("-" * 50)
print("\n[완료] 테스트 완료!")
print("\n예상 최종 키워드 순위:")
print("  1. 요금제 (5)")
print("  2. 데이터 (4)")
print("  3. 해지 (3)")
print("  4. 할인 (2)")
print("  5. 혜택 (2)")
print("  6. 나머지 (각 1)")

