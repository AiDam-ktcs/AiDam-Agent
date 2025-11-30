# AiDam Backend - Quick Start Guide

## 🚀 빠른 시작 (3단계)

### 1단계: 의존성 설치

```bash
# 루트 디렉토리에서
cd backend

# 모든 서비스의 의존성 한번에 설치
npm run install-all
```

또는 개별 설치:

```bash
# 메인 백엔드
npm install

# Report Agent
cd agents/report-agent
npm install
cd ../..
```

### 2단계: 환경 변수 설정

**메인 백엔드 (.env)**
```bash
cp .env.example .env
```

**Report Agent (.env)**
```bash
cp agents/report-agent/.env.example agents/report-agent/.env
```

**Ollama 사용 시 (기본값):**
- `agents/report-agent/.env`에서 `LLM_PROVIDER=ollama` 확인
- Ollama 설치 및 실행: https://ollama.ai
- 모델 다운로드: `ollama pull gpt-oss:20b`

**OpenAI 사용 시:**
```bash
# agents/report-agent/.env
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4
```

### 3단계: 서비스 실행

**방법 1: 터미널 2개 사용 (권장)**

```bash
# Terminal 1: Report Agent
cd agents/report-agent
npm start
```

```bash
# Terminal 2: 메인 백엔드
npm start
```

**방법 2: 백그라운드 실행**

```bash
# Report Agent 백그라운드 실행
cd agents/report-agent
npm start &

# 메인 디렉토리로 돌아가기
cd ../..

# 메인 백엔드 실행
npm start
```

## ✅ 동작 확인

### 헬스체크

```bash
# 메인 백엔드 상태 확인
curl http://localhost:3000/health

# Report Agent 상태 확인
curl http://localhost:8001/health
```

### 통합 테스트 실행

```bash
npm test
# 또는
node test-agent.js
```

성공 시 다음과 같은 메시지가 표시됩니다:
```
✨ All tests passed!

📊 System Architecture:
   Frontend (5173) → Main Backend (3000) → Report Agent (8001) → LLM
                           ↓
                      reports/ (file storage)
```

## 🌐 프론트엔드 연결

백엔드가 실행 중이면 프론트엔드를 시작합니다:

```bash
cd ../frontend
npm install
npm run dev
```

브라우저에서 http://localhost:5173 접속

## 🎯 서비스 포트

| 서비스 | 포트 | URL |
|--------|------|-----|
| 프론트엔드 | 5173 | http://localhost:5173 |
| 메인 백엔드 | 3000 | http://localhost:3000 |
| Report Agent | 8001 | http://localhost:8001 |
| Ollama (로컬) | 11434 | http://localhost:11434 |

## 🔧 문제 해결

### Report Agent가 시작되지 않을 때

1. 의존성 확인:
```bash
cd agents/report-agent
npm install
```

2. 환경 변수 확인:
```bash
cat .env
# PORT=8001 확인
```

3. 포트 충돌 확인:
```bash
# Windows
netstat -ano | findstr :8001

# Linux/Mac
lsof -i :8001
```

### LLM 연결 오류

**Ollama 사용 시:**
```bash
# Ollama 실행 확인
curl http://localhost:11434/api/tags

# 모델 목록 확인
ollama list

# 모델 없으면 다운로드
ollama pull gpt-oss:20b
```

**OpenAI 사용 시:**
```bash
# API 키 확인
echo $OPENAI_API_KEY  # Linux/Mac
echo %OPENAI_API_KEY%  # Windows

# .env 파일 확인
cat agents/report-agent/.env
```

### 메인 백엔드가 Report Agent를 찾지 못할 때

1. Report Agent 실행 확인:
```bash
curl http://localhost:8001/health
```

2. `.env` 파일 확인:
```bash
cat .env
# REPORT_AGENT_URL=http://localhost:8001
# REPORT_AGENT_ENABLED=true
```

3. 헬스체크로 상태 확인:
```bash
curl http://localhost:3000/health
```

## 📊 API 테스트

### 간단한 분석 요청

```bash
curl -X POST http://localhost:3000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "안녕하세요"},
      {"role": "assistant", "content": "안녕하세요! 무엇을 도와드릴까요?"}
    ]
  }'
```

### 보고서 목록 조회

```bash
curl http://localhost:3000/reports
```

## 🎓 다음 단계

1. **프론트엔드 연결**: 브라우저에서 UI 테스트
2. **샘플 대화 분석**: 프론트엔드에서 샘플 데이터 로드
3. **커스텀 분석**: 자신만의 대화 데이터 업로드
4. **보고서 확인**: 생성된 보고서 확인 및 다운로드

## 📚 추가 문서

- [전체 README](./README.md) - 상세 아키텍처 및 API 문서
- [계획 문서](../agent-architecture.plan.md) - 아키텍처 설계 계획
- [메인 프로젝트 README](../README.md) - 프로젝트 전체 개요

---

**도움이 필요하신가요?** 
- GitHub Issues에 문의하세요
- 또는 팀원에게 연락하세요


