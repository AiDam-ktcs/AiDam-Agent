# AIDAM Upsell Agent

업셀링 가능 여부를 판단하는 AI 에이전트입니다.

## 개요

이 에이전트는 다음 기능을 수행합니다:

1. **고객 의중 분석**: 대화 이력과 RAG 에이전트 제안을 분석하여 고객의 의중을 파악
2. **업셀링 가능성 판단**: 고객 상태와 현재 요금제를 고려하여 업셀링 적절 시점 판단
3. **요금제 추천**: 상황에 맞는 적절한 요금제 추천

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

서버는 **포트 8008**에서 실행됩니다 (rag-agent는 8000, report-agent는 8001 사용).

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

