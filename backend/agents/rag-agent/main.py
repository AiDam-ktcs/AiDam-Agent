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
        # 프로젝트 루트 기준으로 PDF 경로 설정
        current_dir = os.getcwd()
        if os.path.basename(current_dir) == "backend":
            pdf_path = "../내부_상담_메뉴얼.pdf"
        else:
            pdf_path = "./내부_상담_메뉴얼.pdf"
        pdf_loader = PDFRAGLoader(pdf_path=pdf_path)
        pdf_loader.load_and_index()
        
        # RAG 그래프 초기화
        rag_graph = RAGGraph(pdf_loader)
        
        print("=" * 50)
        print("초기화 완료! 서버가 준비되었습니다.")
        print("=" * 50)
        
    except FileNotFoundError as e:
        print(f"\n❌ 오류: {e}")
        print("\nPDF 파일을 찾을 수 없습니다.")
        print("현재 작업 디렉토리:", os.getcwd())
        print("PDF 파일 경로:", os.path.abspath(pdf_path))
        raise
    except Exception as e:
        print(f"\n❌ 초기화 중 오류 발생: {e}")
        raise


# 요청/응답 모델
class ChatRequest(BaseModel):
    message: str
    history: List[Dict[str, str]] = []


class ChatResponse(BaseModel):
    answer: str
    sources: List[Dict[str, Any]]
    history: List[Dict[str, str]]


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
        # RAG 그래프 실행
        result = rag_graph.invoke(
            user_message=request.message,
            history=request.history
        )
        
        return ChatResponse(
            answer=result["answer"],
            sources=result["sources"],
            history=result["history"]
        )
        
    except Exception as e:
        print(f"채팅 처리 중 오류: {e}")
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

