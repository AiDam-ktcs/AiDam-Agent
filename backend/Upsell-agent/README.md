# AIDAM Upsell Agent

업셀링 가능 여부를 판단하는 AI 에이전트입니다.

## 개요

이 에이전트는 다음 기능을 수행합니다:

1. **고객 의중 분석**: 대화 이력과 RAG 에이전트 제안을 분석하여 고객의 의중을 파악
2. **업셀링 가능성 판단**: 고객 상태와 현재 요금제를 고려하여 업셀링 적절 시점 판단
3. **요금제 추천**: 상황에 맞는 적절한 요금제 추천


## 메시지 흐름

# 1. STT -> MainBackend (메시지 수신)

STT 엔진이 음성을 텍스트로 변환하면, MainBackend의 API를 호출합니다.

받는 곳 (MainBackend): POST /api/stt/line
코드 위치: 
backend/MainBackend/agent.js
 (175번째 줄)
전송 데이터 (예시):
```json
{
  "callId": "call-12345",
  "speaker": "customer",  // 또는 "agent"
  "text": "요금제가 너무 비싼 것 같아요.",
  "keywords": ["요금", "비쌈"]
}
```
동작: MainBackend는 이 메시지를 받아서 현재 활성화된 통화(ACTIVE_CALL)의 대화 내역(messages)에 저장합니다.

# 2. MainBackend -> Upsell-agent (릴레이)

메시지 저장이 완료되면, MainBackend는 즉시 Upsell-agent에게 이벤트를 **비동기(Fire-and-Forget)**로 전달합니다. 즉, 응답을 기다리지 않고 바로 쏩니다.

받는 곳 (Upsell-agent): POST /event/on-message
코드 위치: 
backend/Upsell-agent/main.py
 (429번째 줄)
전송 데이터: 단순한 텍스트뿐만 아니라 **분석에 필요한 문맥(Context)**을 함께 묶어서 보냅니다.
```json
{
  "message": {
    "role": "user",
    "content": "요금제가 너무 비싼 것 같아요.",
    "timestamp": "..."
  },
  "recent_history": [ ... ],  // 최근 대화 10개 (문맥 파악용)
  "active_call_context": {    // 고객 정보 및 현재 요금제 정보
    "callId": "call-12345",
    "customer": { "이름": "김철수", "나이": "30", ... },
    "current_plan": "LTE Basic"
  },
  "history_length": 5
}
```

## 3. Upsell-agent API 흐름 요약
STT가 MainBackend의 /api/stt/line으로 텍스트를 쏜다.
MainBackend는 이를 저장하고, 바로 Upsell-agent의 /event/on-message로 **토스(Relay)**한다.
Upsell-agent는 받은 데이터를 바탕으로 분석을 수행한다.


# 업셀링 판단 로직! (아이디어의 핵심!!!!)

Upsell-agent가 메시지 이벤트를 수신한 후 수행하는 작업은 크게 4단계로 나눌 수 있습니다.

# 1단계: 수신 및 필터링 (메인 진입점)
main.py의 /event/on-message 엔드포인트에서 시작합니다.

1. 초기화 확인: 시스템이 준비되었는지 확인합니다.
2. 조건 검사
  - 사용자 발화인가?: 상담원이 아닌 '고객(user)'의 말만 분석합니다.
  - 대화 길이 확인: 너무 초반(인사말 등)이면 분석을 건너뛸 수 있습니다. (현재 코드는 테스트를 위해 완화되어 있음)

# 2단계: 데이터 전처리
분석에 필요한 정보를 정리합니다. MainBackend에서 받은 데이터가 부족할 경우를 대비해 보완합니다.

1. 요금 정보 추정: 고객의 현재 요금제 이름을 보고 월 요금을 추정합니다.
2. 등급(Tier) 분류: 요금 수준에 따라 Basic, Standard, Premium 중 하나로 임시 분류합니다. (예: 6만 원 이상이면 Premium)
3. 고객 정보 정리: 이름, 나이, 데이터 사용량(전월/현월) 등을 LLM에 넣기 좋게 포맷팅합니다.

# 3단계: AI 심층 분석 (LangGraph 워크플로우)
이 단계부터가 핵심 두뇌 역할이며, 3개의 내부 단계를 순차적으로 거칩니다 (intent_analyzer.py).

1. 의중 분석 (Analyze Intent)
  - 입력: 최근 대화 10턴 + 고객 정보
  - AI 작업: 고객이 현재 어떤 상태인지 분류합니다. (예: "가격에 민감함", "데이터 부족해함", "단순 불만", "중립" 등)
  - 출력: 의중 키워드, 신뢰도(%), 감정 점수

2. 업셀링 판단 (Judge Upsell)
  - 입력: 위에서 파악한 의중 + 현재 요금제 정보
  - AI 작업: "이 고객에게 지금 더 비싼 요금제를 권해도 될까?"를 판단합니다.
    - High: 데이터 부족 호소, 업그레이드 관심 등
    - Low/Not Recommended: 가격 불만, 해지 언급 등
  - 출력: 가능성(High/Medium/Low), 판단 근거, 논리적 사고 단계(Reasoning Steps)

3. 요금제 추천 (Recommend Plans)
  - 작업: AI가 아닌 파이썬 규칙(Rule) 기반으로 작동합니다.
  - 로직:
    - 업셀링 가능성이 High이고 현재 Basic 등급이면 -> Standard 요금제 목록에서 선택
    - 고객이 가격 민감이면 -> 더 저렴한 요금제 선택
    - 그 외 -> 유사한 등급의 다른 요금제 선택
  - 출력: 추천 요금제 리스트 (최대 3개)

# 4단계: 결과 전송 (콜백)
분석이 끝나면 결과를 다시 메인 백엔드로 돌려줍니다.

  1. Payload 구성: 의중, 업셀링 가능성, 추천 요금제(Top 1) 등을 JSON으로 만듭니다.
  2. Push: MainBackend의 /internal/upsell-result 주소로 데이터를 쏘아 보냅니다.
  3. 종료: 요청을 마칩니다.


## 구조

```
upsell-agent/
├── main.py                     # FastAPI 서버 (포트 8001)
├── requirements.txt            # 의존성 패키지
├── README.md                   # 문서
├── __init__.py
├── models/
│   ├── __init__.py
│   └── state.py               # LangGraph 상태 모델
└── analysis/
    ├── __init__.py
    └── intent_analyzer.py     # 의중 분석 및 업셀링 판단 그래프
```

## 설치 및 실행

### 1. 의존성 설치

```bash
cd backend/agents/upsell-agent
pip install -r requirements.txt
```

### 2. 환경 변수 설정

프로젝트 루트에 `.env` 파일 생성:

```env
OPENAI_API_KEY=your_openai_api_key_here
CHAT_MODEL=gpt-4o-mini
```

### 3. 서버 실행

```bash
# upsell-agent 디렉토리에서
python main.py

# 또는 uvicorn 직접 사용
uvicorn main:app --host 0.0.0.0 --port 8008 --reload
```

서버는 **포트 8008**에서 실행됩니다.

## API 엔드포인트

### 헬스 체크

```
GET /
GET /health
```

### 전체 분석

```
POST /analyze
```

**요청 예시:**

```json
{
  "conversation_history": [
    {"role": "user", "content": "요금제가 너무 비싸요"},
    {"role": "assistant", "content": "네, 고객님. 확인해보겠습니다."}
  ],
  "current_plan": {
    "plan_name": "LTE30+",
    "monthly_fee": 35000,
    "data_limit": "10GB",
    "call_limit": "무제한",
    "plan_tier": "standard"
  },
  "rag_suggestion": "요금제 변경 안내 스크립트...",
  "customer_info": {"name": "홍길동"}
}
```

**응답 예시:**

```json
{
  "customer_intent": "price_sensitive",
  "intent_description": "현재 요금제가 과하다고 느끼고 있습니다.",
  "intent_confidence": 0.85,
  "sentiment_score": -0.3,
  "upsell_possibility": "not_recommended",
  "upsell_reason": "고객이 가격에 민감한 상태로 업셀링보다는 적절한 요금제 안내가 필요합니다.",
  "recommended_action": "고객의 실제 사용량을 확인하고 더 저렴한 요금제를 안내해주세요.",
  "recommended_plans": [
    {
      "plan_name": "실속 LTE",
      "monthly_fee": 19000,
      "data_limit": "5GB",
      "call_limit": "무제한",
      "plan_tier": "basic"
    }
  ]
}
```

### 간편 분석

대화 이력과 기본 요금제 정보만으로 빠른 분석:

```
POST /analyze/quick
```

**요청:**

```json
{
  "conversation_history": [
    {"role": "user", "content": "데이터가 자꾸 부족해요"}
  ],
  "current_plan_name": "알뜰 LTE",
  "current_plan_fee": 15000
}
```

### 의중 분석만

업셀링 판단 없이 고객 의중만 빠르게 분석:

```
POST /intent-only
```

## 고객 의중 분류

| 분류 | 설명 |
|------|------|
| `price_sensitive` | 가격에 민감함 |
| `data_hungry` | 데이터를 많이 필요로 함 |
| `upgrade_interested` | 업그레이드에 관심 있음 |
| `downgrade_wanted` | 다운그레이드를 원함 |
| `neutral` | 중립적 |
| `complaint` | 불만 상태 |
| `satisfied` | 만족 상태 |

## 업셀링 가능성 레벨

| 레벨 | 설명 |
|------|------|
| `high` | 업셀링 적극 권장 |
| `medium` | 업셀링 가능 |
| `low` | 업셀링 어려움 |
| `not_recommended` | 업셀링 비권장 |

## 다른 에이전트와의 통합

### 메인 백엔드를 통한 사용 (권장)

```javascript
// 프론트엔드에서 메인 백엔드 API Gateway 사용
const response = await fetch('http://localhost:3000/upsell/analyze/quick', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    conversation_history: [
      { role: 'user', content: '요금제가 비싸요' },
      { role: 'assistant', content: '네, 확인해보겠습니다.' }
    ],
    current_plan_name: 'LTE30+',
    current_plan_fee: 35000
  })
});
```

### rag-agent와 함께 사용 (직접 호출)

```python
import httpx

# 1. RAG 에이전트에서 스크립트 제안 받기
rag_response = httpx.post("http://localhost:8000/chat", json={
    "message": "요금제가 비싸요",
    "history": []
})

# 2. Upsell 에이전트로 분석
upsell_response = httpx.post("http://localhost:8008/analyze", json={
    "conversation_history": [{"role": "user", "content": "요금제가 비싸요"}],
    "current_plan": {
        "plan_name": "LTE30+",
        "monthly_fee": 35000,
        "data_limit": "10GB",
        "call_limit": "무제한",
        "plan_tier": "standard"
    },
    "rag_suggestion": rag_response.json()["answer"]
})
```

## 포트 정보

| 에이전트 | 포트 | 설명 |
|----------|------|------|
| rag-agent | 8000 | 상담 가이드 RAG |
| report-agent | 8001 | 상담 분석 리포트 |
| upsell-agent | 8008 | 업셀링 판단 |
| main-backend | 3000 | API Gateway (Orchestrator) |

## 라이선스

MIT License

