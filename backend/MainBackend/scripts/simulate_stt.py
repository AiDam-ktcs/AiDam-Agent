import requests
import json
import time

# Main Backend URL
BASE_URL = "http://localhost:3000"

def simulate_call(phone_number, messages, delay=1.0):
    print(f"[Simulation] Starting call with {phone_number}...")
    
    # 1. Call Start
    try:
        data = {
            "callId": f"sim-script-{int(time.time())}",
            "phoneNumber": phone_number,
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%S.000Z', time.gmtime()) 
        }
        res = requests.post(f"{BASE_URL}/api/stt/call-start", json=data)
        if res.status_code == 200:
            print(f"[Success] Call Started: {json.dumps(res.json(), ensure_ascii=False)}")
        else:
            print(f"[Error] Call Start Failed: {res.text}")
            return
    except Exception as e:
        print(f"[Error] Connection Failed: {e}")
        return

    # 2. Send Lines
    for idx, msg in enumerate(messages):
        time.sleep(delay)
        
        # 'user' -> 'customer', 'assistant' -> 'agent'
        speaker = 'customer' if msg.get('role') == 'user' else 'agent'
        text = msg.get('content')
        
        payload = {
            "callId": "current",
            "speaker": speaker,
            "text": text,
            "keywords": msg.get('keywords', [])
        }
        
        try:
            res = requests.post(f"{BASE_URL}/api/stt/line", json=payload)
            if res.status_code == 200:
                 print(f"[{idx+1}/{len(messages)}] Sent ({speaker}): {text[:30]}...")
            else:
                 print(f"[Error] Line Send Failed: {res.text}")
        except Exception as e:
            print(f"[Error] Line Send Error: {e}")

    print("[Simulation] Completed.")

if __name__ == "__main__":
    # Test Data (Example: Yun Min-kyung)
    TARGET_PHONE = "010-3792-6582"
    SAMPLE_MESSAGES = [
        {"role": "user", "content": "통화품질이 너무 안 좋아요. 계속 끊기고 잡음도 심해요."},
        {"role": "assistant", "content": "고객님, 불편하셨겠습니다. 현재 사용하시는 지역과 기기 모델을 알려주시겠어요?"},
        {"role": "user", "content": "서울 강남이고요, 갤럭시 S23 쓰고 있어요."}
    ]

    print("=== STT Simulation Script ===")
    print(f"Target Backend: {BASE_URL}")
    
    use_input = input("Use custom phone number? (y/N): ")
    if use_input.lower() == 'y':
        TARGET_PHONE = input("Enter Phone Number: ")
    
    simulate_call(TARGET_PHONE, SAMPLE_MESSAGES)
