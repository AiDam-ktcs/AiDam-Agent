# RAG Agent - 상담 가이드 에이전트

RAG (Retrieval-Augmented Generation) 기반으로 내부 상담 매뉴얼을 참조하여 상담사에게 실시간 가이드를 제공하는 에이전트입니다.

## 🎯 기능

- **PDF 기반 RAG**: 내부 상담 매뉴얼 PDF를 벡터화하여 검색
- **LangGraph 플로우**: 구조화된 RAG 워크플로우
- **FastAPI**: Python 기반 고성능 API 서버
- **OpenAI 임베딩**: 고품질 벡터 임베딩 및 LLM 답변 생성

## 📋 요구사항

- Python 3.8+
- OpenAI API 키
- `내부_상담_메뉴얼.pdf` 파일 (프로젝트 루트에 위치)

## 🚀 실행 방법

### 1. Python 가상환경 생성 (권장)

```bash
cd backend/agents/rag-agent

# Windows
python -m venv venv
venv\Scripts\activate

# Linux/Mac
python3 -m venv venv
source venv/bin/activate
```

### 2. 의존성 설치

```bash
pip install -r requirements.txt
```

### 3. 환경 변수 설정

```bash
# .env 파일 생성
cp .env.example .env

# .env 파일 편집
# OPENAI_API_KEY=your-api-key-here
```

### 4. 서버 실행

```bash
# 개발 모드 (자동 리로드)
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# 프로덕션 모드
uvicorn main:app --host 0.0.0.0 --port 8000
```

또는:

```bash
python main.py
```

## 📡 API 엔드포인트

### GET `/`
헬스체크

**응답:**
```json
{
  "status": "ok",
  "service": "AIDAM 상담 가이드 API",
  "version": "1.0.0"
}
```

### POST `/chat`
상담 가이드 생성

**요청:**
```json
{
  "message": "요금제 변경하고 싶어요",
  "history": [
    {"role": "user", "content": "안녕하세요"},
    {"role": "assistant", "content": "안녕하세요 고객님"}
  ]
}
```

**응답:**
```json
{
  "answer": "네, 요금제 변경 도와드리겠습니다...",
  "sources": [
    {
      "content": "요금제 변경 절차...",
      "page": 5
    }
  ],
  "history": [...]
}
```

## 🔧 통합 방법

### 메인 백엔드 (Node.js)에서 호출

```javascript
const response = await fetch('http://localhost:8000/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    message: '고객 문의 내용',
    history: []
  })
});

const data = await response.json();
console.log(data.answer); // 상담 가이드
```

## 📁 파일 구조

```
rag-agent/
├── main.py                 # FastAPI 메인 애플리케이션
├── requirements.txt        # Python 의존성
├── .env                    # 환경 변수 (생성 필요)
├── .env.example            # 환경 변수 예시
├── README.md               # 이 파일
├── models/
│   ├── __init__.py
│   └── state.py           # LangGraph 상태 모델
└── rag/
    ├── __init__.py
    ├── loader.py          # PDF 로더 및 벡터 스토어
    └── graph.py           # RAG 그래프 플로우
```

## 🐛 문제 해결

### PDF 파일을 찾을 수 없음

```bash
# 현재 위치 확인
pwd

# 프로젝트 루트로 이동
cd ../../..

# PDF 파일 확인
ls -la 내부_상담_메뉴얼.pdf
```

### OpenAI API 키 오류

```bash
# .env 파일 확인
cat .env

# API 키가 올바르게 설정되었는지 확인
echo $OPENAI_API_KEY  # Linux/Mac
echo %OPENAI_API_KEY%  # Windows
```

## 📚 기술 스택

- **FastAPI**: Python 웹 프레임워크
- **LangChain**: LLM 애플리케이션 프레임워크
- **LangGraph**: 상태 기반 워크플로우
- **FAISS**: 벡터 유사도 검색
- **OpenAI**: 임베딩 및 LLM
- **pypdf**: PDF 파싱

## 🔗 관련 문서

- [FastAPI 공식 문서](https://fastapi.tiangolo.com/)
- [LangChain 공식 문서](https://python.langchain.com/)
- [LangGraph 공식 문서](https://langchain-ai.github.io/langgraph/)

