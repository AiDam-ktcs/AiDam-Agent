"""LangGraph 상태 모델 정의"""
from typing import List, Dict, Any, TypedDict, Optional


class CallState(TypedDict):
    """LangGraph 상태 정의"""
    recent_user_utterance: str
    history: List[Dict[str, str]]
    retrieved_docs: List[Dict[str, Any]]
    answer: str
    
    # 맥락 분석 필드 추가
    context_decision: Optional[str]  # "GENERATE" or "SKIP"
    current_intent: Optional[str]  # 현재 대화 intent
    last_intent: Optional[str]  # 이전 대화 intent
    importance_score: Optional[float]  # 중요도 점수 (0-1)
    decision_reason: Optional[str]  # 판단 이유
    should_generate: Optional[bool]  # 생성 여부

