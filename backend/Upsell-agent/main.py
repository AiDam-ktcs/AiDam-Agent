"""FastAPI 백엔드 - Upsell Agent (업셀링 판단 에이전트)"""
import os
import sys
from pathlib import Path
import httpx
import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from dotenv import load_dotenv

# 프로젝트 루트를 Python 경로에 추가
sys.path.insert(0, str(Path(__file__).parent))

from analysis.intent_analyzer import IntentAnalyzerGraph, PLAN_DATABASE

# 환경 변수 로드
load_dotenv()

# 전역 변수
intent_analyzer: Optional[IntentAnalyzerGraph] = None
CUSTOMER_API_URL = os.getenv("CUSTOMER_API_URL", "http://localhost:3000/active-call")


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
        print(f"MainBackend URL: {CUSTOMER_API_URL}")
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

class ScriptRequest(BaseModel):
    """스크립트 생성 요청"""
    conversation_history: List[Dict[str, str]]
    current_plan: PlanInfo
    target_plan: PlanInfo
    customer_intent: Optional[str] = "neutral"
    intent_description: Optional[str] = ""

class ScriptResponse(BaseModel):
    """스크립트 생성 응답"""
    script: str

class ActiveCallContext(BaseModel):
    callId: str
    customer: Dict[str, Any]
    current_plan: str

class MessageEvent(BaseModel):
    message: Dict[str, Any]
    recent_history: List[Dict[str, Any]]
    active_call_context: ActiveCallContext
    history_length: int

async def fetch_customer_info() -> Dict[str, Any]:
    """MainBackend에서 현재 통화 중인 고객 정보 조회"""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(CUSTOMER_API_URL, timeout=3.0)
            if resp.status_code == 200:
                data = resp.json()
                if data.get("active") and data.get("call"):
                    customer = data["call"]["customer"]
                    # 데이터 포맷팅
                    return {
                        "name": customer.get("이름"),
                        "age": customer.get("나이"),
                        "phone": customer.get("번호"),
                        "plan": customer.get("요금제"),
                        "usage": {
                            "prev": customer.get("전월 데이터"),
                            "curr": customer.get("현월 데이터")
                        }
                    }
    except Exception as e:
        print(f"고객 정보 조회 실패: {e}")
    return {}

def estimate_billing(plan_name: str) -> int:
    """요금제 이름으로 월 요금 추정 (기본료)"""
    for segment in PLAN_DATABASE.values():
        for plan in segment:
            if plan["plan_name"] == plan_name:
                return plan["monthly_fee"]
    return 0

@app.post("/generate-script", response_model=ScriptResponse)
async def generate_script_endpoint(request: ScriptRequest):
    """추천 스크립트 생성"""
    global intent_analyzer
    if intent_analyzer is None:
        raise HTTPException(status_code=503, detail="Not initialized")
    
    script = intent_analyzer.generate_script(
        conversation_history=request.conversation_history,
        current_plan=request.current_plan.model_dump(),
        target_plan=request.target_plan.model_dump(),
        customer_intent=request.customer_intent,
        intent_description=request.intent_description
    )
    return ScriptResponse(script=script)



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

        # 고객 정보가 없으면 자동 조회
        customer_info = request.customer_info
        if not customer_info:
            data = await fetch_customer_info()
            if data:
                # Billing calculation logic
                billing = estimate_billing(data.get("plan"))
                if billing == 0:
                    billing = current_plan["monthly_fee"]
                
                customer_info = {
                    "name": data.get("name"),
                    "age": data.get("age"),
                    "usage": data.get("usage"),
                    "billing": billing,
                    "segment": "general" # TODO: infer segment
                }
                
                # Update current plan if found
                if data.get("plan") and data.get("plan") != "Unknown":
                    current_plan["plan_name"] = data.get("plan")
                    current_plan["monthly_fee"] = billing
                    # Tier inference could be improved
                    if billing >= 60000:
                        current_plan["plan_tier"] = "premium"
                    elif billing >= 40000:
                        current_plan["plan_tier"] = "standard"
                    else:
                        current_plan["plan_tier"] = "basic"
        
        # 분석 실행
        result = intent_analyzer.invoke(
            conversation_history=request.conversation_history,
            current_plan=current_plan,
            rag_suggestion=request.rag_suggestion,
            customer_info=customer_info
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
        
        # 고객 정보 자동 조회 (Quick Analyze에서도 적용)
        customer_info = {}
        data = await fetch_customer_info()
        if data:
            billing = estimate_billing(data.get("plan"))
            customer_info = {
                "name": data.get("name"),
                "age": data.get("age"),
                "usage": data.get("usage"),
                "billing": billing or request.current_plan_fee
            }
            if data.get("plan"):
                 current_plan["plan_name"] = data.get("plan")
                 current_plan["monthly_fee"] = billing or request.current_plan_fee
        
        # 분석 실행
        result = intent_analyzer.invoke(
            conversation_history=request.conversation_history,
            current_plan=current_plan,
            customer_info=customer_info
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

        # 고객 정보 자동 조회
        data = await fetch_customer_info()
        if data:
             billing = estimate_billing(data.get("plan"))
             if data.get("plan"):
                 current_plan["plan_name"] = data.get("plan")
                 current_plan["monthly_fee"] = billing or request.current_plan_fee
        
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



@app.post("/event/on-message")
async def on_message_event(event: MessageEvent):
    """
    메인 백엔드로부터 새로운 메시지 수신 (이벤트 기반 분석)
    - 사용자 메시지인 경우에만 분석 시도 (또는 특정 조건)
    - 분석 결과는 MainBackend의 /internal/upsell-result 로 푸시
    """
    global intent_analyzer
    if intent_analyzer is None:
        return {"status": "ignored", "reason": "not_initialized"}

    # 1. 분석 조건 확인 (Throttling Logic)
    # 예: 사용자 메시지일 때만, 그리고 대화가 어느 정도 진행되었을 때
    if event.message.get("role") != "user":
        return {"status": "ignored", "reason": "not_user_message"}
    
    # 예: 너무 초반이면 스킵 (인사말 등)
    # [Mod for Test] 테스트를 위해 길이 제한을 완화합니다.
    if event.history_length < 1: 
        return {"status": "ignored", "reason": "not_enough_history"}

    # 2. 분석 실행 (Background Task로 돌려도 되지만, 여기선 async로 바로 실행)
    try:
        print(f"Analyzing intent for call {event.active_call_context.callId}...")
        
        # 현재 요금제 정보 추정
        plan_name = event.active_call_context.current_plan
        monthly_fee = estimate_billing(plan_name)
        if monthly_fee == 0:
            monthly_fee = 35000 # Default
        
        tier = "standard"
        if monthly_fee >= 60000: tier = "premium"
        elif monthly_fee < 30000: tier = "basic"

        current_plan = {
            "plan_name": plan_name,
            "monthly_fee": monthly_fee,
            "data_limit": "알 수 없음",
            "call_limit": "무제한",
            "plan_tier": tier
        }

        # 고객 정보
        customer_info = {
            "name": event.active_call_context.customer.get("이름"),
            "age": event.active_call_context.customer.get("나이"),
            "usage": {
                "prev": event.active_call_context.customer.get("전월 데이터"),
                "curr": event.active_call_context.customer.get("현월 데이터")
            }
        }

        # Intent Analyzer 호출
        # 전체 히스토리가 아니라 recent_history만 사용해도 충분한지 확인 필요
        # 하지만 Graph는 10개 정도면 충분하도록 설계됨
        result = intent_analyzer.invoke(
            conversation_history=event.recent_history,
            current_plan=current_plan,
            customer_info=customer_info
        )

        # 3. 결과 MainBackend로 전송
        # 필요한 정보만 추려서 전송
        analysis_payload = {
            "customer_intent": result["customer_intent"],
            "intent_description": result.get("intent_description", ""),
            "upsell_possibility": result["upsell_possibility"],
            "upsell_reason": result.get("upsell_reason", ""),
            "reasoning_steps": result.get("reasoning_steps", []),
            "recommended_plans": result["recommended_plans"][:1], # Top 1만 전송하거나 다 보내거나
            "top_recommendation": result["recommended_plans"][0] if result["recommended_plans"] else None
        }

        # MainBackend로 Push
        main_backend_url = "http://localhost:3000" # 내부 네트워크 주소
        push_url = f"{main_backend_url}/internal/upsell-result"
        
        async with httpx.AsyncClient() as client:
            await client.post(push_url, json={
                "callId": event.active_call_context.callId,
                "analysisResult": analysis_payload
            }, timeout=3.0)
            
        print(f"Analysis result pushed to MainBackend for {event.active_call_context.callId}")
        return {"status": "analyzed", "intent": result["customer_intent"]}

    except Exception as e:
        print(f"Event analysis failed: {e}")
        return {"status": "error", "message": str(e)}


if __name__ == "__main__":
    import uvicorn
    # rag-agent (8000)와 분리된 포트 사용
    uvicorn.run(app, host="0.0.0.0", port=8008)
