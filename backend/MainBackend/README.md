# AiDam Backend - Microservices Architecture

## 🏗️ 아키텍처

```
┌─────────────────┐
│  Frontend       │
│  React (5173)   │
└────────┬────────┘
         │ HTTP
┌────────▼────────────┐
│  Main Backend       │
│  (Orchestrator)     │
│  Express (3000)     │
└────────┬────────────┘
         │
         ├─────────────┐
         │ HTTP        │ HTTP
┌────────▼──────┐ ┌───▼─────────────┐
│  Report Agent │ │  Future Agents  │
│  (8001)       │ │  - STT (8002)   │
│  - Analysis   │ │  - RAG (8003)   │
│  - Reports    │ └─────────────────┘
└───────┬───────┘
        │
   ┌────▼────┐
   │   LLM   │
   │ (Ollama │
   │ /OpenAI)│
   └─────────┘
```

## 📁 폴더 구조

```
backend/
├── agent.js                    # 메인 백엔드 (Orchestrator)
├── package.json                # 메인 의존성
├── .env                        # 메인 환경 변수
├── .env.example               # 환경 변수 예시
├── reports/                    # 보고서 저장소
├── agents/
│   └── report-agent/          # Report Agent (최종 정리 에이전트)
│       ├── server.js          # Report Agent API 서버
│       ├── package.json       # Agent 의존성
│       ├── .env               # Agent 환경 변수
│       ├── .env.example      # Agent 환경 변수 예시
│       └── services/
│           ├── analyzer.js    # 대화 분석 로직
│           └── reporter.js    # 보고서 생성 로직
├── shared/                     # 공통 모듈
│   ├── llm-client.js          # LLM 호출 공통 로직
│   └── schemas.js             # API 스키마 정의
├── config/
│   └── agents.config.js       # 에이전트 설정
└── test-agent.js              # 통합 테스트

```

## 🚀 실행 방법

### 1. 환경 설정

**메인 백엔드 (.env)**
```bash
cp .env.example .env
```

```.env
PORT=3000
NODE_ENV=development
REPORT_AGENT_URL=http://localhost:8001
REPORT_AGENT_ENABLED=true
```

**Report Agent (agents/report-agent/.env)**
```bash
cd agents/report-agent
cp .env.example .env
```

```.env
PORT=8001
LLM_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gpt-oss:20b
# 또는 OpenAI 사용
# LLM_PROVIDER=openai
# OPENAI_API_KEY=your-api-key
# OPENAI_MODEL=gpt-4
```

### 2. 의존성 설치

**메인 백엔드**
```bash
npm install
```

**Report Agent**
```bash
cd agents/report-agent
npm install
cd ../..
```

### 3. 서비스 실행

**Terminal 1: Report Agent 먼저 시작**
```bash
cd agents/report-agent
npm start
# 또는 개발 모드
npm run dev
```

**Terminal 2: 메인 백엔드 시작**
```bash
npm run agent
# 또는
node agent.js
```

### 4. 테스트

```bash
node test-agent.js
```

## 📡 API 엔드포인트

### 메인 백엔드 (포트 3000)

| 메서드 | 엔드포인트 | 설명 | 위임 대상 |
|--------|------------|------|-----------|
| GET | `/health` | 전체 시스템 상태 확인 | - |
| GET | `/models` | 사용 가능한 LLM 모델 | Report Agent |
| POST | `/analyze` | 대화 분석 | Report Agent |
| POST | `/generate-report` | 보고서 생성 | Report Agent |
| POST | `/process` | 통합 프로세스 (SSE) | Report Agent |
| GET | `/reports` | 보고서 목록 조회 | 로컬 파일 |
| GET | `/reports/:id` | 특정 보고서 조회 | 로컬 파일 |
| DELETE | `/reports/:id` | 보고서 삭제 | 로컬 파일 |

### Report Agent (포트 8001)

| 메서드 | 엔드포인트 | 설명 |
|--------|------------|------|
| GET | `/health` | Report Agent 상태 확인 |
| POST | `/analyze` | 대화 분석 수행 |
| POST | `/generate` | 보고서 생성 수행 |
| POST | `/process` | 통합 프로세스 (SSE) |

## 🔧 설정

### 에이전트 활성화/비활성화

**config/agents.config.js**에서 에이전트 설정 관리:

```javascript
module.exports = {
  agents: {
    report: {
      name: 'Report Agent',
      url: 'http://localhost:8001',
      enabled: true,  // ← 여기서 활성화/비활성화
      // ...
    }
  }
};
```

또는 환경 변수로 제어:

```bash
REPORT_AGENT_ENABLED=false  # Report Agent 비활성화
```

## 🎯 주요 특징

### 1. 마이크로서비스 아키텍처
- 각 에이전트가 독립적으로 실행
- 메인 백엔드가 orchestrator 역할
- 에이전트 추가/제거 용이

### 2. 에러 처리 및 복원력
- Report Agent 미응답 시 명확한 에러 메시지
- 헬스체크로 에이전트 상태 모니터링
- 타임아웃 설정 (기본 60초)

### 3. 공통 모듈
- `shared/llm-client.js`: LLM 호출 로직 재사용
- `shared/schemas.js`: API 스키마 및 유틸리티
- 중복 코드 최소화

### 4. 확장 가능성
- STT Agent 추가 준비 완료 (포트 8002)
- RAG Agent 추가 준비 완료 (포트 8003)
- 설정 파일로 간편한 관리

## 🔍 디버깅

### Report Agent가 응답하지 않을 때

1. Report Agent가 실행 중인지 확인:
```bash
curl http://localhost:8001/health
```

2. 메인 백엔드 헬스체크:
```bash
curl http://localhost:3000/health
```

3. 로그 확인:
```bash
# Report Agent 로그
cd agents/report-agent
npm start

# 메인 백엔드 로그
node agent.js
```

### LLM 연결 문제

**Ollama 사용 시:**
```bash
# Ollama가 실행 중인지 확인
curl http://localhost:11434/api/tags

# 모델 다운로드
ollama pull gpt-oss:20b
```

**OpenAI 사용 시:**
```bash
# .env 파일에 API 키 설정 확인
OPENAI_API_KEY=sk-...
```

## 📊 모니터링

### 헬스체크 응답 예시

```json
{
  "ok": true,
  "mode": "orchestrator",
  "service": "Main Backend (API Gateway)",
  "timestamp": "2025-11-28T...",
  "agents": {
    "report": {
      "ok": true,
      "status": "healthy",
      "agent": "Report Agent",
      "data": {
        "ok": true,
        "service": "Report Agent",
        "provider": "ollama",
        "model": "gpt-oss:20b"
      }
    }
  },
  "reports_dir": "D:\\GitHub\\AiDam-Agent\\backend\\reports"
}
```

## 🚧 향후 계획

### STT Agent (포트 8002)
- 실시간 음성→텍스트 변환
- Whisper 또는 Google STT 연동
- 통화 중 실시간 스트리밍

### RAG Agent (포트 8003)
- 벡터 DB 기반 스크립트 검색
- 실시간 답변 제안
- 상담사 지원 기능

## 📝 개발 가이드

### 새로운 에이전트 추가하기

1. **폴더 구조 생성**
```bash
mkdir -p agents/my-agent/services
```

2. **server.js 작성**
```javascript
const express = require('express');
const app = express();
// ... 에이전트 로직
app.listen(8004);
```

3. **config/agents.config.js에 추가**
```javascript
myagent: {
  name: 'My Agent',
  url: 'http://localhost:8004',
  enabled: true,
  // ...
}
```

4. **메인 백엔드에 라우팅 추가**
```javascript
app.post('/myagent/action', async (req, res) => {
  // agent 호출 로직
});
```

## 📚 관련 문서

- [프로젝트 메인 README](../README.md)
- [프론트엔드 문서](../frontend/README.md)
- [에이전트 아키텍처 계획](../agent-architecture.plan.md)

---

**문의사항이나 이슈가 있으시면 GitHub Issues에 등록해주세요.**


