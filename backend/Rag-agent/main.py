"""FastAPI 백엔드 메인 애플리케이션"""
import os
import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
from dotenv import load_dotenv

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


if __name__ == "__main__":
    import uvicorn
    """
    불필요한 코드 정리를 위해 주석 처리리
    # 프로젝트 루트에서 실행되도록 작업 디렉토리 확인
    import os
    if os.path.basename(os.getcwd()) == "backend":
        # backend 디렉토리에서 실행 중이면 상위로 이동
        os.chdir("..")
    """
    uvicorn.run(app, host="0.0.0.0", port=8000)

