# AiDam 에이담 - AI 고객 상담 분석 시스템

## 🎯 프로젝트 개요

**AiDam**은 고객 상담 대화를 분석하고 인사이트를 제공하는 AI 기반 에이전트 시스템입니다.

- **프론트엔드**: React 18.2.0 + Vite 5.4.21 (포트 5173)
- **백엔드**: Express 4.18.2 + LLM Agent (포트 3000)
- **AI 엔진**: Ollama (gpt-oss:20b) 또는 OpenAI (gpt-4)
- **분석 기능**: 감정 분석, 주제 추출, 개선점 제안, 상담 품질 평가
- **UI/UX**: 채팅 버블 UI, 2패널 레이아웃, 마크다운 리포트

## 🚀 실행 방법

### 필수 요구사항
- Node.js 16+ (프론트엔드)
- npm 또는 yarn 패키지 매니저

### 프론트엔드 실행 (React)

#### 1. Real 모드 (기본)
```bash
## 🚀 실행 방법

### 필수 요구사항
- Node.js 18+
- npm 또는 yarn
- Ollama (로컬 LLM 사용 시) 또는 OpenAI API Key

### 1. 환경 설정

```bash
# backend/.env 파일 생성
LLM_PROVIDER=ollama           # 'ollama' 또는 'openai'
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gpt-oss:20b
OPENAI_API_KEY=your-api-key   # OpenAI 사용 시
OPENAI_MODEL=gpt-4
```

### 2. 백엔드 실행

**방법 1: 메인 백엔드만 실행 (권장, 폴백 모드)**
```bash
cd backend
npm install
npm start    # 포트 3000에서 시작
```
→ Report Agent 없이도 모든 기능 작동 (Ollama 직접 호출)

**방법 2: 마이크로서비스 모드 (선택사항)**
```bash
# 터미널 1: Report Agent
cd backend/agents/report-agent
npm install
npm start    # 포트 8001

# 터미널 2: 메인 백엔드
cd backend
npm start    # 포트 3000
```
→ Report Agent를 별도 서비스로 실행 (확장성 향상)

### 3. 프론트엔드 실행

```bash
cd frontend
npm install
npm run dev      # 포트 5173에서 시작
```

### 4. 접속

## 🔧 프로젝트 구조 (마이크로서비스 아키텍처)

```
AiDam-Agent/
├── backend/                       # 백엔드 (마이크로서비스)
│   ├── agent.js                   # 메인 백엔드 (Orchestrator, 포트 3000)
│   ├── .env                       # 메인 백엔드 환경 변수
│   ├── package.json               # 메인 백엔드 의존성
│   ├── reports/                   # 생성된 보고서 저장 디렉토리
│   │   └── *.json                 # 분석 보고서 JSON 파일
│   ├── agents/                    # 마이크로서비스 에이전트들
│   │   └── report-agent/          # Report Agent (대화 분석)
│   │       ├── server.js          # Report Agent API 서버 (포트 8001)
│   │       ├── .env               # Report Agent 환경 변수
│   │       ├── package.json       # Report Agent 의존성
│   │       └── services/
│   │           ├── analyzer.js    # 대화 분석 로직
│   │           └── reporter.js    # 보고서 생성 로직
│   ├── shared/                    # 공통 모듈
│   │   ├── llm-client.js          # LLM 호출 공통 로직
│   │   └── schemas.js             # API 스키마 정의
│   └── config/
│       └── agents.config.js       # 에이전트 설정 관리
│
├── frontend/                      # React 프론트엔드 (Vite)
│   ├── src/
│   │   ├── AgentDashboard.jsx     # 메인 대시보드 컴포넌트
│   │   ├── agent-styles.css       # 화이트-그레이 테마 스타일
│   │   └── main-agent.jsx         # Vite 진입점
│   ├── public/
│   │   └── sample-conversations/  # 샘플 대화 데이터
│   │       ├── conversation0.json # 인터넷 장애 문의
│   │       ├── conversation1.json # 통화품질 문의
│   │       └── ... (총 10개)      # 다양한 통신사 상담 시나리오
│   ├── package.json               # 프론트엔드 의존성
│   └── vite.config.js             # Vite 설정
│
├── sample-conversations/          # 원본 샘플 데이터 (백업)
└── README.md                      # 프로젝트 문서
```

**아키텍처:**
```
Frontend (5173) → Main Backend (3000) → Report Agent (8001, 선택사항) → LLM (Ollama)
                         ↓
                  reports/ (파일 저장)
```

**투트랙 방식:**
- Report Agent 있으면 → 마이크로서비스 모드
- Report Agent 없으면 → 폴백 모드 (메인 백엔드에서 직접 처리)

- **[Menu2 API 명세서](./docs/Menu2API.md)**: 대시보드 및 통계 API 명세
- **[Menu3 API 명세서](./docs/Menu3API.md)**: 전환서비스추천 시스템 API 명세
- **[Menu4 API 명세서](./docs/Menu4API.md)**: 디지털 추모관 관련 API 명세
- **[사용자 관리 API 명세서](./docs/UserManagementAPI.md)**: 사용자 계정 관리 API 명세


## 🛠️ 기술 스택

**Frontend (React)**
- React 18.3.1 (UI 라이브러리)
- React Router DOM 6.28.0 (SPA 라우팅)
- React Bootstrap 2.10.10 (UI 컴포넌트)
- Bootstrap 5.3.7 (CSS 프레임워크)
- Chart.js 4.5.0 & react-chartjs-2 5.3.0 (데이터 시각화)
- Axios 1.11.0 (HTTP 클라이언트)
- Font Awesome 6.0.0 (아이콘 라이브러리)
- PapaParse 5.4.1 (CSV 파싱)

**Development Tools**
- Create React App 5.0.1 (개발 환경)
- React Scripts 5.0.1 (빌드 도구)
- React Testing Library (테스팅)
- Jest (단위 테스트)
- Web Vitals (성능 측정)

**CSS & Styling**
- CSS3 (커스텀 스타일)
- Bootstrap Icons
- 반응형 디자인 (모바일 퍼스트)
- CSS Grid & Flexbox

**State Management & Routing**
- React Context API (전역 상태 관리)
- React Hooks (useState, useEffect, useContext)
- Protected Routes (인증 기반 라우팅)
- Local Storage (토큰 저장)


## 🚧 개발 중인 기능

### 1. 🎯 3칸 레이아웃 대시보드
- 좌측: 채팅 메시지 패널 (사용자/상담사 대화)
- 중앙: AI 어시스턴트 패널 (실시간 분석 예정)
- 우측: 상담 보고서 패널 (수동 생성)
- 통합 헤더: 프로젝트명, 통화 컨트롤, 샘플 로드 버튼

### 2. 🤖 실시간 AI 어시스턴트 (중앙 패널)
- 📋 **실시간 감정 분석**: 통화 중 고객 감정 모니터링
- 📋 **답변 제안**: 상담사에게 실시간 응대 가이드
- 📋 **위험 알림**: 불만 고객 조기 감지 및 경고
- 🔨 **현재 상태**: 플레이스홀더 UI만 구현 ("AI 어시스턴트 기능 준비 중")

### 3. 📊 상담 보고서 시스템 (우측 패널)
- ✅ **LLM 기반 분석**: Ollama/OpenAI 이중 프로바이더
- ✅ **한글 마크다운**: 요약, 감정, 주제, 인사이트, 개선점
- ✅ **수동 생성**: "보고서 제작" 버튼 클릭 시 생성
- ✅ **파일 저장**: backend/reports/ JSON 저장
- ⚠️ **자동 분석 제거**: 통화 종료 시 자동 생성 기능 삭제

### 4. 📞 통화 컨트롤 시스템
- 🔨 **통화 상태 표시**: callStatus (idle/active) 기반 UI
- 🔨 **전화번호 표시**: currentPhoneNumber 상태 관리
- 🔨 **통화 종료 버튼**: UI만 구현 (실제 통화 연동 없음)
- 📋 **향후 계획**: WebSocket 기반 실시간 통화 연동

### 5. 📝 데이터 입력 방식
- ✅ **샘플 대화 로드**: 10개 통신사 시나리오 (conversation0-9.json)
- 📋 **파일 업로드**: JSON/텍스트 파일 파싱 (미완성)
- 📋 **실시간 STT**: 음성→텍스트 변환 (미구현)
- 📋 **CRM 연동**: 외부 시스템 통합 (미구현)

### 6. 🔐 인증 및 권한
- 📋 **로그인/회원가입**: 미구현
- 📋 **JWT 토큰**: 인증 시스템 없음
- 📋 **사용자 권한**: 상담사/관리자 구분 없음

### 7. 📈 대시보드 및 통계
- 📋 **상담 통계**: 전체 건수, 평균 시간, 해결율
- 📋 **감정 추이 그래프**: 시간별 감정 변화
- 📋 **주제 빈도 분석**: TOP 10 문의 유형
- 📋 **상담사 성과**: 개별 상담사 KPI

### 8. 🔌 LLM 프로바이더
- ✅ **Ollama**: localhost:11434, gpt-oss:20b
- ✅ **OpenAI**: API 기반, gpt-4
- ✅ **환경 변수 전환**: LLM_PROVIDER=ollama/openai
- 📋 **추가 프로바이더**: Anthropic Claude, Google Gemini 예정

## 🛠️ 기술 스택

### Frontend
- **React 18.2.0**: UI 라이브러리
- **react-dom 18.2.0**: React DOM 렌더링
- **Vite 5.0.0**: 빌드 도구 (빠른 HMR, ESM 기반)
- **react-markdown 10.1.0**: 마크다운 렌더링
- **remark-gfm 4.0.1**: GitHub Flavored Markdown 지원
- **rehype-raw 7.0.0**: HTML in Markdown 지원
- **rehype-sanitize 6.0.0**: XSS 방지
- **@vitejs/plugin-react 4.0.0**: React Fast Refresh

### Backend
- **Express 4.18.2**: Node.js 웹 프레임워크
- **cors 2.8.5**: CORS 미들웨어
- **node-fetch 2.6.7**: HTTP 클라이언트 (Ollama/OpenAI API 호출)
- **dotenv 16.0.3**: 환경 변수 관리
- **File System (fs)**: 보고서 JSON 파일 저장/조회

### AI/LLM
- **이중 프로바이더 지원**:
  - **Ollama** (로컬): localhost:11434, gpt-oss:20b, 비용 절감, 데이터 프라이버시
  - **OpenAI** (클라우드): API 기반, gpt-4, 고성능, 안정성
- **한글 프롬프트 엔지니어링**: 모든 분석과 보고서를 한국어로 생성
- **JSON 추출**: 구조화된 분석 결과 파싱 (정규식 기반)
- **스트리밍 응답**: 실시간 LLM 출력

### 스타일링
- **CSS3**: 커스텀 스타일 (agent-styles.css)
- **화이트-그레이 테마**: 깔끔한 UI (#f5f5f5 배경)
- **채팅 버블 디자인**: 사용자/상담사 구분 (좌/우 정렬)
- **애니메이션**: pulse, blink, hover 트랜지션

### 개발 도구
- **Git**: 버전 관리
- **npm**: 패키지 관리
- **PowerShell**: Windows 터미널
- **VS Code**: 개발 환경

## 🚧 개발 중인 기능

### 1. 💬 3칸 레이아웃 대시보드
- ✅ **좌측 패널**: 고객 상담 대화 (채팅 버블 UI)
- 🔨 **가운데 패널**: AI 실시간 어시스턴트 (키워드 추출, RAG 기반 스크립트 제안)
- ✅ **우측 패널**: 상담 보고서 (수동 생성 버튼 방식)

### 2. 🎯 실시간 AI 어시스턴트 (예정)
- 📋 **STT 연동**: 음성을 텍스트로 실시간 변환하여 좌측 채팅에 표시
- 📋 **키워드 추출**: 대화 중 핵심 키워드 즉시 추출
- 📋 **RAG 기반 제안**: 사전 등록된 스크립트 데이터에서 적절한 응답 검색 및 제시
- 📋 **LLM 답변 생성**: 실시간으로 상담사에게 추천 답변 제공
- 📋 **즉각적 인사이트**: 통화 중 고객 감정 및 상황 분석

### 3. 📊 상담 보고서 시스템
- ✅ **수동 생성**: "보고서 생성" 버튼 클릭 시 분석 시작
- ✅ **LLM 기반 분석**: 감정, 주제, 인사이트, 개선점 추출
- ✅ **한글 마크다운**: 구조화된 보고서 생성
- ✅ **히스토리 관리**: 과거 보고서 저장 및 조회

### 4. 📞 통화 컨트롤 시스템
- ✅ **통화 상태 표시**: 대기/수신/통화중/종료 상태 UI
- ✅ **전화번호 표시**: 통화 중인 고객 번호 표시
- 🔨 **통화 종료 기능**: 실제 통화 시스템 연동 예정
- 🔨 **녹음 기능**: 실시간 녹음 및 저장 기능 예정

### 5. 📤 데이터 입력 방식
- ✅ **샘플 대화**: 10개 통신사 상담 시나리오 (테스트용)
- ✅ **파일 업로드**: JSON/텍스트 파일 업로드 및 자동 파싱
- 📋 **실시간 STT**: 음성 → 텍스트 실시간 변환 (향후 구현)

### 6. 🔐 인증 및 권한 (예정)
- 📋 **로그인/회원가입**: 사용자 계정 관리
- 📋 **JWT 토큰**: 세션 인증
- 📋 **역할 기반 권한**: 관리자/상담사 구분

### 7. 📈 대시보드 및 통계 (예정)
- 📋 **상담 통계**: 일/주/월별 상담 건수, 평균 통화 시간
- 📋 **감정 추이 분석**: 시간대별 고객 감정 변화
- 📋 **주제 빈도 분석**: 가장 많은 문의 유형
- 📋 **상담사 성과**: 개별 상담사별 품질 평가
- 📋 **실시간 모니터링**: 현재 진행 중인 상담 현황

### 8. 🤖 LLM 프로바이더
- ✅ **Ollama 지원**: 로컬 LLM 서버 (gpt-oss:20b)
- ✅ **OpenAI 지원**: 클라우드 API (gpt-4)
- ✅ **한글 프롬프트**: 모든 분석을 한국어로 수행
- ✅ **환경 변수 전환**: .env 파일로 프로바이더 선택

## 📋 API 엔드포인트

### Backend API (포트 3000)

| 메서드 | 엔드포인트 | 설명 |
|--------|------------|------|
| POST | `/process` | 대화 분석 + 보고서 생성 (통합) |
| POST | `/analyze` | 대화 분석만 수행 |
| POST | `/generate-report` | 분석 결과로부터 보고서 생성 |
| GET | `/reports` | 저장된 보고서 목록 조회 |
| GET | `/reports/:id` | 특정 보고서 조회 |
| DELETE | `/reports/:id` | 보고서 삭제 |
| GET | `/health` | 서버 상태 확인 |

### 요청 형식

```json
{
  "messages": [
    {"role": "user", "content": "안녕하세요"},
    {"role": "assistant", "content": "네 안녕하세요"}
  ]
}
```

### 응답 형식

```json
{
  "analysis": {
    "sentiment": "긍정적, 약간의 불만",
    "main_topics": ["인터넷 장애", "긴급 처리"],
    "key_insights": ["고객 불만 신속 처리", "..."],
    "improvement_suggestions": ["..."],
    "statistics": {
      "total_messages": 10,
      "user_messages": 5,
      "assistant_messages": 5,
      "average_message_length": 45
    }
  },
  "report": "# 상담 분석 보고서\n\n## 요약\n...",
  "timestamp": "2025-11-26T14:30:00.000Z",
  "id": "report_1732624200000"
}
```

## 🎯 사용 시나리오

### 시나리오 1: 샘플 대화 분석
1. "📝 샘플 대화" 버튼 클릭
2. 원하는 샘플 선택 (예: #3 청구서 이상)
3. 대화 내용 자동 로드
4. 자동 분석 시작 (autoAnalyze=true)
5. 리포트 확인

### 시나리오 2: 텍스트 파일 업로드
1. "📁 파일 업로드" 버튼 클릭
2. `.txt` 또는 `.json` 파일 선택
3. 자동 파싱 및 분석
4. 리포트 생성

### 시나리오 3: 히스토리 관리
1. "📚 히스토리" 버튼 클릭
2. 과거 보고서 목록 확인
3. 특정 보고서 클릭하여 재열람
4. 불필요한 보고서 삭제

## 🔧 환경 변수 설정

### backend/.env

```bash
# LLM 프로바이더 선택 ('ollama' 또는 'openai')
LLM_PROVIDER=ollama

# Ollama 설정 (로컬 LLM)
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=gpt-oss:20b

# OpenAI 설정 (클라우드 LLM)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4
```

### 프로바이더 전환

**Ollama 사용 (비용 절감, 로컬 실행)**
```bash
LLM_PROVIDER=ollama
```

**OpenAI 사용 (고성능, 안정성)**
```bash
LLM_PROVIDER=openai
```

## 🚀 배포

### 프론트엔드 빌드

```bash
cd frontend
npm run build
# dist/ 폴더에 정적 파일 생성
```

### 백엔드 프로덕션 실행

```bash
cd backend
NODE_ENV=production node agent.js
```

## 📝 개발자 노트

- **한글 프롬프트**: 모든 LLM 프롬프트와 응답이 한국어로 작성됨
- **이중 프로바이더**: Ollama와 OpenAI 간 전환 가능
- **파일 기반 저장**: 보고서는 `backend/reports/`에 JSON 파일로 저장
- **자동 분석**: 대화 로드 시 자동으로 분석 시작
- **마크다운 렌더링**: react-markdown으로 보고서 시각화

---

**프로젝트**: AiDam (에이담)  
**버전**: v1.0.0  
**최종 업데이트**: 2025년 11월 26일