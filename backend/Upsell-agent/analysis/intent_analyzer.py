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


# 요금제 데이터 로드
from pathlib import Path

def load_pricing_plans():
    """pricing_plan.json에서 요금제 정보를 로드합니다."""
    try:
        current_dir = Path(__file__).parent.parent
        plan_file_path = current_dir / "docs" / "pricing_plan.json"
        
        with open(plan_file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"요금제 데이터 로드 중 오류 발생: {e}")
        # 파일이 없을 경우를 대비한 기본값 (fallback)
        return {
            "general": [
                {"plan_name": "일반 LTE 무제한", "monthly_fee": 49900, "data_limit": "LTE 무제한", "call_limit": "무제한", "plan_tier": "standard"},
                {"plan_name": "일반 5G 무제한", "monthly_fee": 69000, "data_limit": "5G 무제한", "call_limit": "무제한", "plan_tier": "premium"}
            ]
        }

PLAN_DATABASE = load_pricing_plans()


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


현재 고객 상세 정보:
- 이름: {customer_name}
- 나이: {customer_age}
- 요금제명: {current_plan_name}
- 월 기본료: {current_plan_fee}원
- 데이터 기본제공: {current_plan_data}
- 요금제 등급: {current_plan_tier}
- 전월 데이터 사용량: {prev_month_usage}
- 현월 데이터 사용량: {curr_month_usage}
- 예상 청구 금액(현월): {estimated_billing}원 (기본료 기준)
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

현재 고객 상황:
- 성명/나이: {customer_name} ({customer_age})
- 현재 요금제: {current_plan_name} ({current_plan_fee}원, {current_plan_tier})
- 데이터 사용현황: 전월 {prev_month_usage} / 현월 {curr_month_usage}
- 예상 청구액: {estimated_billing}원

업셀링 가능성을 판단하고 JSON 형식으로 반환하세요. reasoning_steps에는 판단에 이르게 된 논리적 사고 과정을 순서대로 3~4단계로 서술하세요.""")
        ])
        
        # 스크립트 생성 프롬프트
        self.script_prompt = ChatPromptTemplate.from_messages([
            ("system", """당신은 베테랑 통신사 상담사입니다.
고객에게 새로운 요금제를 제안하는 자연스럽고 설득력 있는 스크립트를 작성해주세요.

맥락:
- 고객은 '{customer_intent}' 상태입니다 ({intent_description}).
- 현재 요금제: {current_plan_name} ({current_plan_fee}원)
- 추천 요금제: {target_plan_name} ({target_plan_fee}원, {target_plan_data})
- 핵심 소구점: {selling_point}

작성 지침:
- 고객의 현재 상황(데이터 부족, 요금 부담 등)을 공감하며 시작하세요.
- 추천 요금제의 장점을 명확히 설명하되, 고객의 니즈와 연결하세요.
- 너무 길지 않게(3~4문장), 구어체로 자연스럽게 작성하세요.
- "고객님," 으로 시작하세요.
"""),
            ("human", """대화 이력:
{conversation_history}

위 대화 흐름을 이어가면서 자연스럽게 요금제를 권유하는 스크립트를 작성해주세요.""")
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
            current_plan_tier=current_plan.get("plan_tier", "standard"),
            customer_name=state.get("customer_info", {}).get("name", "고객"),
            customer_age=state.get("customer_info", {}).get("age", "알 수 없음"),
            prev_month_usage=state.get("customer_info", {}).get("usage", {}).get("prev", "정보 없음"),
            curr_month_usage=state.get("customer_info", {}).get("usage", {}).get("curr", "정보 없음"),
            estimated_billing=state.get("customer_info", {}).get("billing", current_plan.get("monthly_fee", 0))
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
            customer_name=state.get("customer_info", {}).get("name", "고객"),
            customer_age=state.get("customer_info", {}).get("age", "알 수 없음"),
            current_plan_name=current_plan.get("plan_name", "알 수 없음"),
            current_plan_fee=current_plan.get("monthly_fee", 0),
            current_plan_tier=current_plan.get("plan_tier", "standard"),
            prev_month_usage=state.get("customer_info", {}).get("usage", {}).get("prev", "정보 없음"),
            curr_month_usage=state.get("customer_info", {}).get("usage", {}).get("curr", "정보 없음"),
            estimated_billing=state.get("customer_info", {}).get("billing", current_plan.get("monthly_fee", 0))
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
        """요금제 추천 (세그먼트 및 등급 기반)"""
        current_plan = state["current_plan"]
        upsell_possibility = state["upsell_possibility"]
        customer_intent = state["customer_intent"]
        customer_info = state.get("customer_info", {}) or {}
        
        current_tier = current_plan.get("plan_tier", "standard")
        
        # 1. 고객 세그먼트 결정
        segment = "general" # 기본값
        
        # customer_info에서 세그먼트 정보 확인
        if "segment" in customer_info and customer_info["segment"] in PLAN_DATABASE:
            segment = customer_info["segment"]
        elif "age" in customer_info:
            try:
                age = int(customer_info["age"])
                if age < 20:
                    segment = "youth"
                elif age >= 65:
                    segment = "senior"
            except (ValueError, TypeError):
                pass
        
        if customer_info.get("is_soldier"):
            segment = "military"
            
        # 해당 세그먼트의 전체 요금제 목록 가져오기
        available_plans = PLAN_DATABASE.get(segment, PLAN_DATABASE.get("general", []))
        
        # 등급별 분류
        basic_plans = [p for p in available_plans if p.get("plan_tier") == "basic"]
        standard_plans = [p for p in available_plans if p.get("plan_tier") == "standard"]
        premium_plans = [p for p in available_plans if p.get("plan_tier") == "premium"]
        
        recommended_plans = []
        
        # 2. 업셀링/다운그레이드 로직에 따른 추천
        if upsell_possibility in ["high", "medium"]:
            # 업셀링 가능 - 상위 요금제 추천
            if current_tier == "basic":
                recommended_plans = standard_plans
                # 만약 standard가 없으면 premium 추천
                if not recommended_plans:
                    recommended_plans = premium_plans
            elif current_tier == "standard":
                recommended_plans = premium_plans
            else:
                # 이미 premium이면 같은 등급 내 더 비싼 요금제나 다른 혜택
                recommended_plans = [p for p in premium_plans 
                                    if p["plan_name"] != current_plan.get("plan_name")]
        
        elif customer_intent == "price_sensitive" or customer_intent == "downgrade_wanted":
            # 다운그레이드 - 하위 요금제 추천
            if current_tier == "premium":
                recommended_plans = standard_plans
                if not recommended_plans:
                    recommended_plans = basic_plans
            elif current_tier == "standard":
                recommended_plans = basic_plans
            else:
                # 이미 basic이면 더 저렴한 basic 찾기
                current_fee = current_plan.get("monthly_fee", 0)
                recommended_plans = [p for p in basic_plans 
                                    if p.get("monthly_fee", 0) < current_fee]
        
        else:
            # 현재 등급과 유사한 요금제 (중립)
            if current_tier == "basic":
                recommended_plans = basic_plans
            elif current_tier == "standard":
                recommended_plans = standard_plans
            else:
                recommended_plans = premium_plans
                
            # 현재 요금제 제외
            recommended_plans = [p for p in recommended_plans 
                                if p["plan_name"] != current_plan.get("plan_name")]
        
        # 결과가 없으면 전체 목록에서 다른 것 추천
        if not recommended_plans:
             recommended_plans = [p for p in available_plans 
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


    def generate_script(
        self,
        conversation_history: List[Dict[str, str]],
        current_plan: Dict[str, Any],
        target_plan: Dict[str, Any],
        customer_intent: str = "neutral",
        intent_description: str = ""
    ) -> str:
        """추천 스크립트 생성"""
        
        # 대화 이력 포맷팅
        history_text = "\n".join([
            f"{msg['role']}: {msg['content']}"
            for msg in conversation_history[-5:]  # 최근 5개만
        ])
        
        # 소구점 파악 (간단한 로직)
        selling_point = "더 많은 혜택"
        if target_plan.get("monthly_fee", 0) > current_plan.get("monthly_fee", 0):
            selling_point = "더 많은 데이터와 풍부한 혜택"
        elif target_plan.get("monthly_fee", 0) < current_plan.get("monthly_fee", 0):
            selling_point = "통신비 절감"
        
        prompt = self.script_prompt.format_messages(
            conversation_history=history_text,
            customer_intent=customer_intent,
            intent_description=intent_description,
            current_plan_name=current_plan.get("plan_name", ""),
            current_plan_fee=current_plan.get("monthly_fee", 0),
            target_plan_name=target_plan.get("plan_name", ""),
            target_plan_fee=target_plan.get("monthly_fee", 0),
            target_plan_data=target_plan.get("data_limit", ""),
            selling_point=selling_point
        )
        
        response = self.llm.invoke(prompt)
        return response.content
