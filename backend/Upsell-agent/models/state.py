"""LangGraph 상태 모델 정의 - Upsell Agent"""
from typing import List, Dict, Any, TypedDict, Optional
from enum import Enum


class UpsellPossibility(str, Enum):
    """업셀링 가능성 레벨"""
    HIGH = "high"          # 업셀링 적극 권장
    MEDIUM = "medium"      # 업셀링 가능
    LOW = "low"            # 업셀링 어려움
    NOT_RECOMMENDED = "not_recommended"  # 업셀링 비권장


class CustomerIntent(str, Enum):
    """고객 의중 분류"""
    PRICE_SENSITIVE = "price_sensitive"        # 가격에 민감
    DATA_HUNGRY = "data_hungry"                # 데이터 많이 필요
    UPGRADE_INTERESTED = "upgrade_interested"  # 업그레이드 관심
    DOWNGRADE_WANTED = "downgrade_wanted"      # 다운그레이드 원함
    NEUTRAL = "neutral"                        # 중립적
    COMPLAINT = "complaint"                    # 불만 상태
    SATISFIED = "satisfied"                    # 만족 상태


class PlanInfo(TypedDict):
    """요금제 정보"""
    plan_name: str                    # 요금제 이름
    monthly_fee: int                  # 월 요금
    data_limit: str                   # 데이터 제한 (예: "10GB", "무제한")
    call_limit: str                   # 통화 제한
    plan_tier: str                    # 요금제 등급 (basic, standard, premium)


class UpsellState(TypedDict):
    """Upsell Agent LangGraph 상태 정의"""
    # 입력 데이터
    conversation_history: List[Dict[str, str]]  # 대화 이력
    rag_suggestion: Optional[str]               # RAG 에이전트 제안 내용
    current_plan: PlanInfo                      # 현재 고객 요금제
    customer_info: Dict[str, Any]               # 고객 정보
    
    # 분석 결과
    customer_intent: str                        # 고객 의중
    intent_confidence: float                    # 의중 판단 신뢰도 (0-1)
    sentiment_score: float                      # 감정 점수 (-1 ~ 1)
    
    # 업셀링 판단
    upsell_possibility: str                     # 업셀링 가능성
    upsell_reason: str                          # 업셀링 판단 이유
    reasoning_steps: List[str]                  # 사고 과정 단계
    recommended_action: str                     # 권장 행동
    recommended_plans: List[Dict[str, Any]]     # 추천 요금제 목록


class AnalysisResult(TypedDict):
    """분석 결과 응답 형식"""
    customer_intent: str
    intent_description: str
    intent_confidence: float
    sentiment_score: float
    upsell_possibility: str
    upsell_reason: str
    reasoning_steps: List[str]
    recommended_action: str
    recommended_plans: List[Dict[str, Any]]

