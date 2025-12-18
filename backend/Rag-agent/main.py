"""FastAPI 백엔드 메인 애플리케이션"""
import os
import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from dotenv import load_dotenv
import httpx

# 프로젝트 루트를 Python 경로에 추가
sys.path.insert(0, str(Path(__file__).parent.parent))

# 경로 변경: 통합 프로젝트 구조에 맞춰서
# from backend.rag.loader import PDFRAGLoader
#from backend.rag.graph import RAGGraph
from rag.loader import PDFRAGLoader
from rag.graph import RAGGraph

# 환경 변수 로드
load_dotenv()

app = FastAPI(title="AIDAM 상담 가이드 API", version="1.0.0")

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 전역 변수
pdf_loader: Optional[PDFRAGLoader] = None
rag_graph: Optional[RAGGraph] = None


@app.on_event("startup")
async def startup_event():
    """애플리케이션 시작 시 초기화"""
    global pdf_loader, rag_graph
    
    try:
        # API 키 확인
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.")
        
        print("=" * 50)
        print("AIDAM 상담 가이드 시스템 초기화 중...")
        print("=" * 50)
        
        # PDF 로더 초기화
        # Rag-agent 디렉토리 기준으로 PDF 경로 설정
        script_dir = os.path.dirname(os.path.abspath(__file__))
        pdf_path = os.path.join(script_dir, "docs", "consultation_manual.pdf")
        pdf_loader = PDFRAGLoader(pdf_path=pdf_path)
        pdf_loader.load_and_index()
        
        # RAG 그래프 초기화
        rag_graph = RAGGraph(pdf_loader)
        
        print("=" * 50)
        print("초기화 완료! 서버가 준비되었습니다.")
        print("=" * 50)
        
    except FileNotFoundError as e:
        print(f"\n[ERROR] {e}")
        print("\nPDF 파일을 찾을 수 없습니다.")
        print("현재 작업 디렉토리:", os.getcwd())
        print("PDF 파일 경로:", os.path.abspath(pdf_path))
        raise
    except Exception as e:
        print(f"\n[ERROR] Initialization failed: {e}")
        raise


# 요청/응답 모델
class ChatRequest(BaseModel):
    message: str
    history: List[Dict[str, str]] = []
    force_generate: bool = False  # True면 스킵 로직 무시하고 무조건 생성


class ChatResponse(BaseModel):
    answer: str
    sources: List[Dict[str, Any]]
    history: List[Dict[str, str]]
    skipped: bool = False  # 맥락 분석 결과 SKIP 여부
    reason: str = ""  # SKIP 또는 GENERATE 이유


class SearchRequest(BaseModel):
    query: str
    k: int = 3


class SearchResponse(BaseModel):
    sources: List[Dict[str, Any]]


# 이벤트 기반 메시지 처리용 모델 (Upsell Agent와 동일한 패턴)
class ActiveCallContext(BaseModel):
    callId: str
    customer: Dict[str, Any] = {}
    current_plan: str = "Unknown"


class MessageEvent(BaseModel):
    message: Dict[str, Any]
    recent_history: List[Dict[str, Any]] = []
    active_call_context: ActiveCallContext
    history_length: int = 0


@app.get("/")
async def root():
    """헬스 체크"""
    return {
        "status": "ok",
        "service": "AIDAM 상담 가이드 API",
        "version": "1.0.0"
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """채팅 엔드포인트"""
    global rag_graph
    
    if rag_graph is None:
        raise HTTPException(
            status_code=503,
            detail="현재 시스템 문제로 내부 상담 매뉴얼 조회가 어렵습니다."
        )
    
    try:
        # RAG 그래프 실행 (맥락 분석 포함)
        result = rag_graph.invoke(
            user_message=request.message,
            history=request.history,
            force_generate=request.force_generate
        )
        
        return ChatResponse(
            answer=result["answer"],
            sources=result["sources"],
            history=result["history"],
            skipped=result.get("skipped", False),
            reason=result.get("reason", "")
        )
        
    except Exception as e:
        print(f"채팅 처리 중 오류: {e}")
        raise HTTPException(
            status_code=500,
            detail="현재 시스템 문제로 내부 상담 매뉴얼 조회가 어렵습니다."
        )


@app.post("/search", response_model=SearchResponse)
async def search(request: SearchRequest):
    """검색 전용 엔드포인트 - LLM 답변 생성 없이 매뉴얼 검색만 수행"""
    global pdf_loader
    
    if pdf_loader is None:
        raise HTTPException(
            status_code=503,
            detail="현재 시스템 문제로 내부 상담 매뉴얼 조회가 어렵습니다."
        )
    
    try:
        # 벡터 검색만 수행 (LLM 호출 없음)
        docs = pdf_loader.search(request.query, k=request.k)
        
        # 검색 결과를 sources 형태로 변환
        sources = [
            {
                "content": doc["content"],
                "page": doc["metadata"].get("page", "N/A"),
                "score": doc["score"]
            }
            for doc in docs
        ]
        
        return SearchResponse(sources=sources)
        
    except Exception as e:
        print(f"검색 처리 중 오류: {e}")
        raise HTTPException(
            status_code=500,
            detail="현재 시스템 문제로 내부 상담 매뉴얼 조회가 어렵습니다."
        )


@app.post("/event/on-message")
async def on_message_event(event: MessageEvent):
    """
    메인 백엔드로부터 새로운 메시지 수신 (이벤트 기반 분석)
    - 사용자 메시지인 경우에만 분석 시도
    - 분석 결과는 MainBackend의 /internal/rag-result 로 푸시
    """
    global rag_graph
    
    print(f"[RAG] Received event: role={event.message.get('role')}, content={event.message.get('content', '')[:30]}...")
    
    if rag_graph is None:
        print("[RAG] rag_graph is None - not initialized")
        return {"status": "ignored", "reason": "not_initialized"}
    
    # 1. 분석 조건 확인 (Filtering)
    current_message_content = event.message.get("content", "").strip()
    
    # [Rule 1] 사용자 메시지일 때만 분석
    if event.message.get("role") != "user":
        print(f"[RAG] Ignored: not user message (role={event.message.get('role')})")
        return {"status": "ignored", "reason": "not_user_message"}
    
    # [Rule 2] 너무 짧은 발화 무시 (공백 제외 3글자 미만으로 완화)
    if len(current_message_content) < 3:
        print(f"[RAG] Ignored: message too short ({len(current_message_content)} chars)")
        return {"status": "ignored", "reason": "message_too_short"}
    
    # [Rule 3] 단순 인사말 필터링 - 완화: 인사만 있는 짧은 메시지만 필터
    greeting_keywords = ["안녕하세요", "여보세요"]
    if current_message_content in greeting_keywords:
        print(f"[RAG] Ignored: pure greeting message")
        return {"status": "ignored", "reason": "greeting_message"}
    
    # [Rule 4] 대화 길이 조건 제거 - 첫 메시지부터 분석
    # (기존: history_length < 2 조건 제거)
    
    # 2. RAG 분석 실행
    try:
        print(f"[RAG] Analyzing message for call {event.active_call_context.callId}: {current_message_content[:50]}...")
        
        # recent_history를 history로 사용 (Upsell과 동일한 패턴)
        # role 변환: user -> user, assistant/agent -> assistant
        history = []
        for msg in event.recent_history:
            role = msg.get("role", "user")
            if role in ["agent", "assistant"]:
                role = "assistant"
            history.append({
                "role": role,
                "content": msg.get("content", "")
            })
        
        # RAG 그래프 실행
        result = rag_graph.invoke(
            user_message=current_message_content,
            history=history,
            force_generate=False
        )
        
        # 3. 결과 MainBackend로 Push
        analysis_payload = {
            "callId": event.active_call_context.callId,
            "result": {
                "query": current_message_content,
                "answer": result.get("answer", ""),
                "sources": result.get("sources", []),
                "skipped": result.get("skipped", False),
                "reason": result.get("reason", "")
            }
        }
        
        # MainBackend로 Push
        main_backend_url = "http://localhost:3000"
        push_url = f"{main_backend_url}/internal/rag-result"
        
        async with httpx.AsyncClient() as client:
            await client.post(push_url, json=analysis_payload, timeout=3.0)
        
        if result.get("skipped"):
            print(f"[RAG] Skipped for {event.active_call_context.callId}: {result.get('reason')}")
            return {"status": "skipped", "reason": result.get("reason")}
        else:
            print(f"[RAG] Result pushed to MainBackend for {event.active_call_context.callId}")
            return {"status": "analyzed", "query": current_message_content[:30]}
        
    except Exception as e:
        print(f"[RAG] Event analysis failed: {e}")
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    import asyncio
    import platform
    
    # Windows asyncio 이벤트 루프 호환성 설정
    if platform.system() == "Windows":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    uvicorn.run(app, host="0.0.0.0", port=8000)

