"""FastAPI 백엔드 - Upsell Agent (업셀링 판단 에이전트)"""
import os
import sys
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from dotenv import load_dotenv

# 프로젝트 루트를 Python 경로에 추가
sys.path.insert(0, str(Path(__file__).parent))

from analysis.intent_analyzer import IntentAnalyzerGraph

# 환경 변수 로드
load_dotenv()

# 전역 변수
intent_analyzer: Optional[IntentAnalyzerGraph] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """애플리케이션 생명주기 관리 (시작/종료 이벤트)"""
    global intent_analyzer
    
    # Startup
    try:
        # API 키 확인
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY 환경 변수가 설정되지 않았습니다.")
        
        print("=" * 50)
        print("AIDAM 업셀링 판단 에이전트 초기화 중...")
        print("=" * 50)
        
        # Intent Analyzer 초기화
        intent_analyzer = IntentAnalyzerGraph()
        
        print("=" * 50)
        print("초기화 완료! 서버가 준비되었습니다.")
        print("포트: 8008")
        print("=" * 50)
        
    except Exception as e:
        print(f"\n❌ 초기화 중 오류 발생: {e}")
        raise
    
    yield
    
    # Shutdown (필요시 정리 작업)
    print("서버 종료 중...")


app = FastAPI(
    title="AIDAM 업셀링 판단 API", 
    version="1.0.0",
    description="고객 대화를 분석하여 업셀링 가능성을 판단하는 에이전트",
    lifespan=lifespan
)

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:5173", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],  # 모든 HTTP 메서드 허용 (OPTIONS 포함)
    allow_headers=["*"],  # 모든 헤더 허용
)


# 요청/응답 모델
class PlanInfo(BaseModel):
    """요금제 정보"""
    plan_name: str = Field(..., description="요금제 이름")
    monthly_fee: int = Field(..., description="월 요금")
    data_limit: str = Field(..., description="데이터 제한")
    call_limit: str = Field(default="무제한", description="통화 제한")
    plan_tier: str = Field(default="standard", description="요금제 등급 (basic, standard, premium)")


class AnalyzeRequest(BaseModel):
    """분석 요청"""
    conversation_history: List[Dict[str, str]] = Field(
        ..., 
        description="대화 이력 [{role: 'user'|'assistant', content: '...'}]"
    )
    current_plan: PlanInfo = Field(..., description="현재 고객 요금제 정보")
    rag_suggestion: Optional[str] = Field(None, description="RAG 에이전트 제안 내용")
    customer_info: Optional[Dict[str, Any]] = Field(None, description="추가 고객 정보")


class RecommendedPlan(BaseModel):
    """추천 요금제"""
    plan_name: str
    monthly_fee: int
    data_limit: str
    call_limit: str
    plan_tier: str


class AnalyzeResponse(BaseModel):
    """분석 응답"""
    customer_intent: str = Field(..., description="고객 의중 분류")
    intent_description: str = Field(..., description="고객 의중 설명")
    intent_confidence: float = Field(..., description="의중 판단 신뢰도 (0-1)")
    sentiment_score: float = Field(..., description="감정 점수 (-1 ~ 1)")
    upsell_possibility: str = Field(..., description="업셀링 가능성 (high, medium, low, not_recommended)")
    upsell_reason: str = Field(..., description="업셀링 판단 이유")
    reasoning_steps: List[str] = Field(default=[], description="사고 과정 단계")
    recommended_action: str = Field(..., description="권장 행동")
    recommended_plans: List[RecommendedPlan] = Field(default=[], description="추천 요금제 목록")


class QuickAnalyzeRequest(BaseModel):
    """간편 분석 요청 (대화 이력만으로 빠른 분석)"""
    conversation_history: List[Dict[str, str]] = Field(
        ..., 
        description="대화 이력"
    )
    current_plan_name: str = Field(default="LTE30+", description="현재 요금제 이름")
    current_plan_fee: int = Field(default=35000, description="현재 월 요금")


@app.get("/")
async def root():
    """헬스 체크"""
    return {
        "status": "ok",
        "service": "AIDAM 업셀링 판단 API",
        "version": "1.0.0",
        "port": 8008
    }


@app.get("/health")
async def health_check():
    """상세 헬스 체크"""
    return {
        "status": "healthy",
        "service": "upsell-agent",
        "analyzer_ready": intent_analyzer is not None
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_conversation(request: AnalyzeRequest):
    """대화 분석 및 업셀링 가능성 판단"""
    global intent_analyzer
    
    if intent_analyzer is None:
        raise HTTPException(
            status_code=503,
            detail="업셀링 분석 시스템이 초기화되지 않았습니다."
        )
    
    try:
        # 요금제 정보 변환
        current_plan = {
            "plan_name": request.current_plan.plan_name,
            "monthly_fee": request.current_plan.monthly_fee,
            "data_limit": request.current_plan.data_limit,
            "call_limit": request.current_plan.call_limit,
            "plan_tier": request.current_plan.plan_tier
        }
        
        # 분석 실행
        result = intent_analyzer.invoke(
            conversation_history=request.conversation_history,
            current_plan=current_plan,
            rag_suggestion=request.rag_suggestion,
            customer_info=request.customer_info
        )
        
        return AnalyzeResponse(
            customer_intent=result["customer_intent"],
            intent_description=result.get("intent_description", ""),
            intent_confidence=result["intent_confidence"],
            sentiment_score=result["sentiment_score"],
            upsell_possibility=result["upsell_possibility"],
            upsell_reason=result["upsell_reason"],
            reasoning_steps=result.get("reasoning_steps", []),
            recommended_action=result["recommended_action"],
            recommended_plans=[
                RecommendedPlan(**plan) for plan in result["recommended_plans"]
            ]
        )
        
    except Exception as e:
        print(f"분석 처리 중 오류: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"분석 중 오류가 발생했습니다: {str(e)}"
        )


@app.post("/analyze/quick", response_model=AnalyzeResponse)
async def quick_analyze(request: QuickAnalyzeRequest):
    """간편 분석 - 기본 요금제 정보로 빠른 분석"""
    global intent_analyzer
    
    if intent_analyzer is None:
        raise HTTPException(
            status_code=503,
            detail="업셀링 분석 시스템이 초기화되지 않았습니다."
        )
    
    try:
        # 기본 요금제 정보 생성
        tier = "basic"
        if request.current_plan_fee >= 50000:
            tier = "premium"
        elif request.current_plan_fee >= 25000:
            tier = "standard"
        
        current_plan = {
            "plan_name": request.current_plan_name,
            "monthly_fee": request.current_plan_fee,
            "data_limit": "알 수 없음",
            "call_limit": "무제한",
            "plan_tier": tier
        }
        
        # 분석 실행
        result = intent_analyzer.invoke(
            conversation_history=request.conversation_history,
            current_plan=current_plan
        )
        
        return AnalyzeResponse(
            customer_intent=result["customer_intent"],
            intent_description=result.get("intent_description", ""),
            intent_confidence=result["intent_confidence"],
            sentiment_score=result["sentiment_score"],
            upsell_possibility=result["upsell_possibility"],
            upsell_reason=result["upsell_reason"],
            reasoning_steps=result.get("reasoning_steps", []),
            recommended_action=result["recommended_action"],
            recommended_plans=[
                RecommendedPlan(**plan) for plan in result["recommended_plans"]
            ]
        )
        
    except Exception as e:
        print(f"간편 분석 처리 중 오류: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"분석 중 오류가 발생했습니다: {str(e)}"
        )


@app.post("/intent-only")
async def analyze_intent_only(request: QuickAnalyzeRequest):
    """의중 분석만 수행 (업셀링 판단 제외, 빠른 응답용)"""
    global intent_analyzer
    
    if intent_analyzer is None:
        raise HTTPException(
            status_code=503,
            detail="업셀링 분석 시스템이 초기화되지 않았습니다."
        )
    
    try:
        # 기본 요금제 정보
        current_plan = {
            "plan_name": request.current_plan_name,
            "monthly_fee": request.current_plan_fee,
            "data_limit": "알 수 없음",
            "call_limit": "무제한",
            "plan_tier": "standard"
        }
        
        # 분석 실행
        result = intent_analyzer.invoke(
            conversation_history=request.conversation_history,
            current_plan=current_plan
        )
        
        # 의중 정보만 반환
        return {
            "customer_intent": result["customer_intent"],
            "intent_description": result.get("intent_description", ""),
            "intent_confidence": result["intent_confidence"],
            "sentiment_score": result["sentiment_score"]
        }
        
    except Exception as e:
        print(f"의중 분석 처리 중 오류: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"분석 중 오류가 발생했습니다: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    # rag-agent (8000)와 분리된 포트 사용
    uvicorn.run(app, host="0.0.0.0", port=8008)

