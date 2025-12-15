"""LangGraph 상태 모델 정의"""
from typing import List, Dict, Any, TypedDict


class CallState(TypedDict):
    """LangGraph 상태 정의"""
    recent_user_utterance: str
    history: List[Dict[str, str]]
    retrieved_docs: List[Dict[str, Any]]
    answer: str

