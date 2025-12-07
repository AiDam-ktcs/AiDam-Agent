"""LangGraph를 사용한 고객 의중 분석 및 업셀링 판단 그래프"""
import os
import json
from typing import Dict, Any, List, Optional
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import StateGraph, END
from dotenv import load_dotenv

from models.state import (
    UpsellState, 
    AnalysisResult, 
    UpsellPossibility, 
    CustomerIntent,
    PlanInfo
)

load_dotenv()


# 요금제 데이터베이스 (실제로는 DB에서 가져옴)
PLAN_DATABASE = {
    "basic": [
        {"plan_name": "알뜰 LTE", "monthly_fee": 15000, "data_limit": "3GB", "call_limit": "100분", "plan_tier": "basic"},
        {"plan_name": "실속 LTE", "monthly_fee": 19000, "data_limit": "5GB", "call_limit": "무제한", "plan_tier": "basic"},
    ],
    "standard": [
        {"plan_name": "LTE30+", "monthly_fee": 35000, "data_limit": "10GB", "call_limit": "무제한", "plan_tier": "standard"},
        {"plan_name": "알뜰 5G", "monthly_fee": 25000, "data_limit": "10GB", "call_limit": "무제한", "plan_tier": "standard"},
    ],
    "premium": [
        {"plan_name": "5G 프리미엄", "monthly_fee": 55000, "data_limit": "무제한", "call_limit": "무제한", "plan_tier": "premium"},
        {"plan_name": "5G 프리미엄+", "monthly_fee": 75000, "data_limit": "무제한", "call_limit": "무제한", "plan_tier": "premium"},
    ]
}


class IntentAnalyzerGraph:
    """고객 의중 분석 및 업셀링 판단 그래프"""
    
    def __init__(self):
        # LLM 초기화
        chat_model = os.getenv("CHAT_MODEL", "gpt-4o-mini")
        self.llm = ChatOpenAI(
            model=chat_model,
            temperature=0.2,  # 분석이므로 더 낮은 temperature
            openai_api_key=os.getenv("OPENAI_API_KEY")
        )
        
        # 의중 분석 프롬프트
        self.intent_prompt = ChatPromptTemplate.from_messages([
            ("system", """당신은 통신사 콜센터 고객 의중 분석 AI입니다.

대화 내용을 분석하여 다음 정보를 JSON 형식으로 반환하세요:

1. customer_intent: 고객 의중 분류
   - "price_sensitive": 가격에 민감함
   - "data_hungry": 데이터를 많이 필요로 함
   - "upgrade_interested": 업그레이드에 관심 있음
   - "downgrade_wanted": 다운그레이드를 원함
   - "neutral": 중립적
   - "complaint": 불만 상태
   - "satisfied": 만족 상태

2. intent_description: 고객 의중을 자연스러운 한국어 문장으로 설명

3. intent_confidence: 의중 판단 신뢰도 (0.0 ~ 1.0)

4. sentiment_score: 감정 점수 (-1.0 부정 ~ 1.0 긍정)

반드시 유효한 JSON 형식으로만 응답하세요.

현재 고객 요금제 정보:
- 요금제명: {current_plan_name}
- 월 요금: {current_plan_fee}원
- 데이터: {current_plan_data}
- 요금제 등급: {current_plan_tier}
"""),
            ("human", """대화 이력:
{conversation_history}

RAG 에이전트 제안 내용:
{rag_suggestion}

위 대화를 분석하여 고객의 의중을 JSON 형식으로 반환하세요.""")
        ])
        
        # 업셀링 판단 프롬프트
        self.upsell_prompt = ChatPromptTemplate.from_messages([
            ("system", """당신은 통신사 콜센터 업셀링 전략 분석 AI입니다.

고객 의중 분석 결과와 현재 요금제 정보를 바탕으로 업셀링 가능성을 판단하세요.

## 업셀링 전략 가이드라인:

1. **업셀링 HIGH (적극 권장)**:
   - 고객이 데이터 부족을 호소하는 경우
   - 고객이 업그레이드에 관심을 표현하는 경우
   - 현재 요금제가 basic 등급이고 사용량이 많은 경우

2. **업셀링 MEDIUM (가능)**:
   - 고객이 중립적 상태이고 더 나은 혜택 제안 가능
   - 현재 요금제 만족하지만 더 나은 옵션 소개 가능

3. **업셀링 LOW (어려움)**:
   - 고객이 가격에 민감한 상태
   - 불만 상태이지만 서비스 관련 불만

4. **업셀링 NOT_RECOMMENDED (비권장)**:
   - 고객이 다운그레이드를 명확히 원함
   - 가격 불만으로 해지 의사 표현
   - 강한 불만 상태

반드시 유효한 JSON 형식으로만 응답하세요:
{{
    "upsell_possibility": "high" | "medium" | "low" | "not_recommended",
    "upsell_reason": "판단 이유 요약",
    "reasoning_steps": ["1. 고객 발화 '...' 에서 ... 니즈 감지", "2. 현재 요금제 대비 ...", "3. 따라서 ... 추천"],
    "recommended_action": "권장 행동 설명"
}}
"""),
            ("human", """고객 의중 분석 결과:
- 의중: {customer_intent}
- 의중 설명: {intent_description}
- 신뢰도: {intent_confidence}
- 감정 점수: {sentiment_score}

현재 요금제 정보:
- 요금제명: {current_plan_name}
- 월 요금: {current_plan_fee}원
- 요금제 등급: {current_plan_tier}

업셀링 가능성을 판단하고 JSON 형식으로 반환하세요. reasoning_steps에는 판단에 이르게 된 논리적 사고 과정을 순서대로 3~4단계로 서술하세요.""")
        ])
        
        # 그래프 구축
        self.graph = self._build_graph()
    
    def _build_graph(self) -> StateGraph:
        """LangGraph 플로우 구축"""
        workflow = StateGraph(UpsellState)
        
        # 노드 추가
        workflow.add_node("analyze_intent", self._analyze_intent)
        workflow.add_node("judge_upsell", self._judge_upsell)
        workflow.add_node("recommend_plans", self._recommend_plans)
        
        # 엣지 정의
        workflow.set_entry_point("analyze_intent")
        workflow.add_edge("analyze_intent", "judge_upsell")
        workflow.add_edge("judge_upsell", "recommend_plans")
        workflow.add_edge("recommend_plans", END)
        
        return workflow.compile()
    
    def _analyze_intent(self, state: UpsellState) -> Dict[str, Any]:
        """고객 의중 분석"""
        conversation_history = state["conversation_history"]
        rag_suggestion = state.get("rag_suggestion", "")
        current_plan = state["current_plan"]
        
        # 대화 이력 포맷팅
        history_text = "\n".join([
            f"{msg['role']}: {msg['content']}"
            for msg in conversation_history[-10:]  # 최근 10개
        ])
        
        # 프롬프트 생성 및 LLM 호출
        prompt = self.intent_prompt.format_messages(
            conversation_history=history_text if history_text else "대화 이력 없음",
            rag_suggestion=rag_suggestion if rag_suggestion else "제안 내용 없음",
            current_plan_name=current_plan.get("plan_name", "알 수 없음"),
            current_plan_fee=current_plan.get("monthly_fee", 0),
            current_plan_data=current_plan.get("data_limit", "알 수 없음"),
            current_plan_tier=current_plan.get("plan_tier", "standard")
        )
        
        response = self.llm.invoke(prompt)
        
        try:
            # JSON 파싱
            result = json.loads(response.content)
            return {
                "customer_intent": result.get("customer_intent", "neutral"),
                "intent_description": result.get("intent_description", ""),
                "intent_confidence": float(result.get("intent_confidence", 0.5)),
                "sentiment_score": float(result.get("sentiment_score", 0.0))
            }
        except json.JSONDecodeError:
            # 파싱 실패 시 기본값
            return {
                "customer_intent": "neutral",
                "intent_description": "분석 결과를 파싱할 수 없습니다.",
                "intent_confidence": 0.3,
                "sentiment_score": 0.0
            }
    
    def _judge_upsell(self, state: UpsellState) -> Dict[str, Any]:
        """업셀링 가능성 판단"""
        current_plan = state["current_plan"]
        
        # 프롬프트 생성 및 LLM 호출
        prompt = self.upsell_prompt.format_messages(
            customer_intent=state["customer_intent"],
            intent_description=state.get("intent_description", ""),
            intent_confidence=state["intent_confidence"],
            sentiment_score=state["sentiment_score"],
            current_plan_name=current_plan.get("plan_name", "알 수 없음"),
            current_plan_fee=current_plan.get("monthly_fee", 0),
            current_plan_tier=current_plan.get("plan_tier", "standard")
        )
        
        response = self.llm.invoke(prompt)
        
        try:
            result = json.loads(response.content)
            return {
                "upsell_possibility": result.get("upsell_possibility", "low"),
                "upsell_reason": result.get("upsell_reason", ""),
                "reasoning_steps": result.get("reasoning_steps", []),
                "recommended_action": result.get("recommended_action", "")
            }
        except json.JSONDecodeError:
            return {
                "upsell_possibility": "low",
                "upsell_reason": "분석 결과를 파싱할 수 없습니다.",
                "reasoning_steps": ["분석 중 오류 발생"],
                "recommended_action": "고객 상황을 더 파악해주세요."
            }
    
    def _recommend_plans(self, state: UpsellState) -> Dict[str, Any]:
        """요금제 추천"""
        current_plan = state["current_plan"]
        upsell_possibility = state["upsell_possibility"]
        customer_intent = state["customer_intent"]
        
        current_tier = current_plan.get("plan_tier", "standard")
        current_fee = current_plan.get("monthly_fee", 0)
        
        recommended_plans = []
        
        if upsell_possibility in ["high", "medium"]:
            # 업셀링 가능 - 상위 요금제 추천
            if current_tier == "basic":
                recommended_plans = PLAN_DATABASE["standard"]
            elif current_tier == "standard":
                recommended_plans = PLAN_DATABASE["premium"]
            else:
                # 이미 premium이면 같은 등급 다른 요금제
                recommended_plans = [p for p in PLAN_DATABASE["premium"] 
                                    if p["plan_name"] != current_plan.get("plan_name")]
        
        elif customer_intent == "price_sensitive" or customer_intent == "downgrade_wanted":
            # 다운그레이드 또는 가격 민감 - 하위 요금제 추천
            if current_tier == "premium":
                recommended_plans = PLAN_DATABASE["standard"]
            elif current_tier == "standard":
                recommended_plans = PLAN_DATABASE["basic"]
            else:
                # 이미 basic이면 같은 등급 다른 요금제
                recommended_plans = [p for p in PLAN_DATABASE["basic"] 
                                    if p["plan_name"] != current_plan.get("plan_name")]
        
        else:
            # 현재 등급 내 다른 요금제
            recommended_plans = [p for p in PLAN_DATABASE.get(current_tier, []) 
                                if p["plan_name"] != current_plan.get("plan_name")]
        
        return {
            "recommended_plans": recommended_plans[:3]  # 최대 3개
        }
    
    def invoke(
        self, 
        conversation_history: List[Dict[str, str]],
        current_plan: Dict[str, Any],
        rag_suggestion: Optional[str] = None,
        customer_info: Optional[Dict[str, Any]] = None
    ) -> AnalysisResult:
        """그래프 실행"""
        
        initial_state: UpsellState = {
            "conversation_history": conversation_history,
            "rag_suggestion": rag_suggestion or "",
            "current_plan": current_plan,
            "customer_info": customer_info or {},
            "customer_intent": "",
            "intent_confidence": 0.0,
            "sentiment_score": 0.0,
            "upsell_possibility": "",
            "upsell_reason": "",
            "reasoning_steps": [],
            "recommended_action": "",
            "recommended_plans": []
        }
        
        result = self.graph.invoke(initial_state)
        
        return {
            "customer_intent": result["customer_intent"],
            "intent_description": result.get("intent_description", ""),
            "intent_confidence": result["intent_confidence"],
            "sentiment_score": result["sentiment_score"],
            "upsell_possibility": result["upsell_possibility"],
            "upsell_reason": result["upsell_reason"],
            "reasoning_steps": result.get("reasoning_steps", []),
            "recommended_action": result["recommended_action"],
            "recommended_plans": result["recommended_plans"]
        }

