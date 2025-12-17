"""LangGraph를 사용한 RAG 플로우 정의"""
import os
import re
from typing import Dict, Any, Literal
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from langgraph.graph import StateGraph, END
from dotenv import load_dotenv

# 경로 변경: 통합 프로젝트 구조에 맞춰서
#from backend.models.state import CallState
#from backend.rag.loader import PDFRAGLoader
from models.state import CallState
from rag.loader import PDFRAGLoader

load_dotenv()


class RAGGraph:
    """RAG 기반 상담 가이드 생성 그래프"""
    
    def __init__(self, pdf_loader: PDFRAGLoader):
        self.pdf_loader = pdf_loader
        
        # LLM 초기화
        chat_model = os.getenv("CHAT_MODEL", "gpt-4o-mini")
        self.llm = ChatOpenAI(
            model=chat_model,
            temperature=0.3,
            openai_api_key=os.getenv("OPENAI_API_KEY")
        )
        
        # 맥락 판단용 경량 LLM (fallback용, 1%만 사용)
        self.classifier_llm = ChatOpenAI(
            model="gpt-4o-mini",
            temperature=0,
            openai_api_key=os.getenv("OPENAI_API_KEY")
        )
        
        # 프롬프트 템플릿
        self.prompt_template = ChatPromptTemplate.from_messages([
            ("system", """당신은 통신사 콜센터 상담사를 돕는 AIDAM 상담 가이드 시스템입니다.

다음 규칙을 반드시 준수하세요:
1. 상담사가 고객에게 그대로 말할 수 있는 자연스러운 대화체로 작성하세요.
2. "네, 고객님" 또는 "네, 확인해드리겠습니다" 등 자연스러운 호응 표현을 사용하세요.
3. 존댓말을 사용하고, 친절하고 전문적인 톤을 유지하세요.
4. 제공된 내부 상담 매뉴얼 내용을 기반으로 답변하세요.
5. 2-4문장 정도로 간결하게 작성하되, 완결된 문장으로 구성하세요.
6. 고객의 상황을 공감하거나 이해하는 표현을 자연스럽게 포함하세요.
7. 필요한 경우 추가 안내나 확인이 필요한 사항을 부드럽게 제안하세요.
8. 매뉴얼에 없는 내용은 "정확한 확인을 위해 추가 조회가 필요합니다" 등으로 안내하세요.
9. 상담사는 고객 정보(이름, 전화번호, 요금제, 사용량)를 이미 확인한 상태입니다. 본인 확인 절차를 요청하지 말고 바로 업무 안내를 하세요.
10. 절차나 단계가 있는 상담은 현재 단계에서 바로 진행할 수 있는 구체적인 액션을 제시하세요.
    예: "가입하려면 절차가 필요합니다" (X) → "지금 바로 가입 도와드리겠습니다. 먼저..." (O)
11. "추가로 궁금한 점", "더 도움이 필요하신", "다른 문의사항" 등의 형식적인 마무리 멘트는 절대 사용하지 마세요.
    답변과 다음 액션 제시로 자연스럽게 종료하세요.
12. 정보를 요청할 때는 한 번에 최대 1-2개만 요청하세요. 여러 정보가 필요하면 가장 중요한 것부터 단계적으로 진행하세요.
    예: "주문번호, 수령자 이름, 배송지 주소를 알려주세요" (X) → "주문번호를 말씀해주시겠어요?" (O)
12. 정보를 요청할 때는 한 번에 최대 1-2개만 요청하세요. 여러 정보가 필요하면 가장 중요한 것부터 단계적으로 진행하세요.
    예: "주문번호, 수령자 이름, 배송지 주소를 알려주세요" (X) → "주문번호를 말씀해주시겠어요?" (O)

내부 상담 매뉴얼 내용:
{context}

대화 이력:
{history}
"""),
            ("human", "고객 발화: {user_utterance}\n\n위 고객 발화에 대해 상담사가 고객에게 직접 말할 수 있는 자연스러운 답변을 작성하세요.")
        ])
        
        # 그래프 구축
        self.graph = self._build_graph()
    
    def _build_graph(self) -> StateGraph:
        """LangGraph 플로우 구축 (맥락 분석 포함)"""
        workflow = StateGraph(CallState)
        
        # 노드 추가
        workflow.add_node("analyze_context", self._analyze_context)
        workflow.add_node("retrieve", self._retrieve_documents)
        workflow.add_node("generate", self._generate_answer)
        
        # 진입점: 맥락 분석부터 시작
        workflow.set_entry_point("analyze_context")
        
        # 조건부 엣지: 맥락 분석 결과에 따라 생성 여부 결정
        workflow.add_conditional_edges(
            "analyze_context",
            self._should_generate,
            {
                "generate": "retrieve",  # 생성 필요 → 문서 검색
                "skip": END              # 생성 불필요 → 종료
            }
        )
        
        # 순차 엣지
        workflow.add_edge("retrieve", "generate")
        workflow.add_edge("generate", END)
        
        return workflow.compile()
    
    def _analyze_context(self, state: CallState) -> Dict[str, Any]:
        """맥락 분석 (하이브리드: 규칙 + Intent + LLM fallback)"""
        utterance = state["recent_user_utterance"].strip()
        history = state.get("history", [])
        
        # Step 1: 규칙 기반 빠른 필터 (80% 케이스)
        rule_result = self._rule_based_filter(utterance, history)
        if rule_result["decision"] in ["SKIP", "GENERATE_URGENT"]:
            decision = "SKIP" if rule_result["decision"] == "SKIP" else "GENERATE"
            return {
                "context_decision": decision,
                "decision_reason": rule_result["reason"],
                "should_generate": decision == "GENERATE",
                "importance_score": rule_result.get("importance", 0.0)
            }
        
        # Step 2: Intent 변화 감지 (15% 케이스)
        intent_result = self._check_intent_change(utterance, history, state.get("last_intent"))
        if intent_result["changed"]:
            return {
                "context_decision": "GENERATE",
                "current_intent": intent_result["current_intent"],
                "last_intent": intent_result["previous_intent"],
                "decision_reason": "intent_change",
                "should_generate": True,
                "importance_score": 0.9
            }
        
        # Step 3: 규칙에 안 걸리면 기본 GENERATE (안 중요한 것만 SKIP하고 나머지는 생성)
        importance = self._calculate_importance(utterance)
        return {
            "context_decision": "GENERATE",
            "current_intent": intent_result["current_intent"],
            "decision_reason": "default_generate",
            "should_generate": True,
            "importance_score": importance
        }
    
    def _rule_based_filter(self, utterance: str, history: list) -> Dict[str, Any]:
        """규칙 기반 1차 필터 (빠른 판단)
        
        순서: 용건/질문 먼저 체크 → 인사/감사만 있으면 SKIP
        """
        
        # 규칙 1: 짧은 맞장구는 스킵
        short_responses = [
            "네", "예", "음", "응", "넵", "알겠어요"
        ]
        if utterance in short_responses or len(utterance) < 3:
            return {
                "decision": "SKIP",
                "reason": "simple_acknowledgment",
                "importance": 0.0
            }
        
        # 규칙 2: 최근 발화와 중복 체크
        if history and len(history) > 0:
            last_user_msg = None
            for msg in reversed(history):
                if msg.get("role") == "user":
                    last_user_msg = msg.get("content", "")
                    break
            
            if last_user_msg and utterance == last_user_msg:
                return {
                    "decision": "SKIP",
                    "reason": "duplicate_utterance",
                    "importance": 0.0
                }
        
        # 규칙 3: 인사/감사 표현만 있으면 → SKIP
        greeting_patterns = [
            "감사합니다", "감사해요", "고마워요",
            "안녕하세요", "수고하세요", "알겠습니다", "알겠어요"
        ]
        if any(pattern in utterance for pattern in greeting_patterns):
            return {
                "decision": "SKIP",
                "reason": "greeting_only",
                "importance": 0.0
            }
        
        # 규칙 4: 종료 신호 감지
        end_signals = [
            "됐습니다", "됐어요", "끊을게요", "필요없어요"
        ]
        if any(signal in utterance for signal in end_signals):
            return {
                "decision": "SKIP",
                "reason": "end_signal",
                "importance": 0.0
            }
        
        # 애매한 케이스 → 다음 단계로
        return {
            "decision": "UNCERTAIN",
            "reason": "uncertain",
            "importance": 0.5
        }
    
    def _check_intent_change(self, utterance: str, history: list, last_intent: str = None) -> Dict[str, Any]:
        """Intent 변화 감지"""
        current_intent = self._extract_intent(utterance)
        
        # 이전 intent 가져오기
        if last_intent is None and history:
            # 히스토리에서 마지막 user 발화의 intent 추정
            for msg in reversed(history):
                if msg.get("role") == "user":
                    last_intent = self._extract_intent(msg.get("content", ""))
                    break
        
        # Intent 변화 감지
        changed = (
            last_intent is not None and
            current_intent != last_intent and
            current_intent != "인사" and  # 인사는 intent 변화로 보지 않음
            last_intent != "인사"
        )
        
        return {
            "changed": changed,
            "current_intent": current_intent,
            "previous_intent": last_intent
        }
    
    def _extract_intent(self, utterance: str) -> str:
        """Intent 추출 (키워드 기반)"""
        intent_keywords = {
            "요금제": ["요금제", "플랜", "가격", "비용", "금액", "얼마"],
            "배송": ["배송", "배달", "도착", "언제", "받을", "수령"],
            "반품환불": ["반품", "환불", "교환", "취소", "돌려"],
            "기술지원": ["안돼", "안됨", "오류", "문제", "고장", "작동", "에러"],
            "계정": ["로그인", "회원", "가입", "비밀번호", "계정", "아이디"],
            "데이터": ["데이터", "용량", "사용량", "남은", "초과"],
            "인사": ["안녕", "감사", "고마", "네", "예", "알겠"]
        }
        
        for intent, keywords in intent_keywords.items():
            if any(kw in utterance for kw in keywords):
                return intent
        
        return "기타"
    
    def _calculate_importance(self, utterance: str) -> float:
        """중요도 계산 (0.0 ~ 1.0)"""
        score = 0.0
        
        # 길이 기반 점수
        if len(utterance) > 20:
            score += 0.3
        elif len(utterance) > 10:
            score += 0.2
        elif len(utterance) > 5:
            score += 0.1
        
        # 중요 키워드 포함 여부
        important_keywords = [
            "문의", "요청", "필요", "어떻게", "언제",
            "해주세요", "알려주세요", "확인", "조회"
        ]
        keyword_count = sum(1 for kw in important_keywords if kw in utterance)
        score += min(keyword_count * 0.2, 0.4)
        
        # 질문 패턴
        if "?" in utterance or utterance.endswith(("요?", "까?", "나요?")):
            score += 0.3
        
        return min(score, 1.0)
    
    def _llm_final_decision(self, utterance: str, history: list) -> Dict[str, Any]:
        """LLM 기반 최종 판단 (fallback, 1% 케이스)"""
        
        # 최근 대화 내역
        recent_history = history[-3:] if len(history) > 0 else []
        history_text = "\n".join([
            f"- {msg['role']}: {msg['content']}"
            for msg in recent_history
        ]) if recent_history else "대화 이력 없음"
        
        prompt = f"""당신은 콜센터 대화 분석 전문가입니다.
현재 고객 발화를 분석하여 상담사에게 새로운 가이드가 필요한지 판단하세요.

최근 대화:
{history_text}

현재 고객 발화: "{utterance}"

새로운 가이드가 필요한 경우:
1. 새로운 주제/문의로 전환
2. 구체적인 질문이나 문제 제기
3. 상담사의 추가 정보 필요
4. 불만이나 긴급한 요청

가이드가 불필요한 경우:
1. 단순 인사말이나 맞장구
2. 이미 답변한 주제의 단순 확인
3. 대화 종료 신호
4. 의미 없는 발화

판단: "GENERATE" 또는 "SKIP"만 답변하세요."""

        try:
            response = self.classifier_llm.invoke(prompt)
            decision = response.content.strip().upper()
            
            if "GENERATE" in decision:
                return {"decision": "GENERATE"}
            else:
                return {"decision": "SKIP"}
        except Exception as e:
            print(f"[WARN] LLM decision failed, using default(GENERATE): {e}")
            # LLM 실패 시 안전하게 GENERATE
            return {"decision": "GENERATE"}
    
    def _should_generate(self, state: CallState) -> Literal["generate", "skip"]:
        """생성 여부 판단 (조건부 엣지용)"""
        decision = state.get("context_decision", "GENERATE")
        reason = state.get("decision_reason", "unknown")
        importance = state.get("importance_score", 0.5)
        
        if decision == "SKIP":
            print(f"[SKIP] {reason} (importance: {importance:.2f}) - '{state['recent_user_utterance']}'")
            return "skip"
        else:
            print(f"[GENERATE] {reason} (importance: {importance:.2f}) - '{state['recent_user_utterance']}'")
            return "generate"
    
    def _retrieve_documents(self, state: CallState) -> Dict[str, Any]:
        """관련 문서 검색"""
        query = state["recent_user_utterance"]
        docs = self.pdf_loader.search(query, k=3)
        
        return {
            "retrieved_docs": docs
        }
    
    def _generate_answer(self, state: CallState) -> Dict[str, Any]:
        """답변 생성"""
        user_utterance = state["recent_user_utterance"]
        retrieved_docs = state["retrieved_docs"]
        history = state.get("history", [])
        
        # 컨텍스트 구성
        context = "\n\n".join([
            f"[문서 {i+1}]\n{doc['content']}"
            for i, doc in enumerate(retrieved_docs)
        ])
        
        # 히스토리 구성
        history_text = "\n".join([
            f"{msg['role']}: {msg['content']}"
            for msg in history[-5:]  # 최근 5개만 사용
        ])
        
        # 프롬프트 생성 및 LLM 호출
        prompt = self.prompt_template.format_messages(
            context=context,
            history=history_text if history_text else "대화 이력 없음",
            user_utterance=user_utterance
        )
        
        response = self.llm.invoke(prompt)
        answer = response.content
        
        # 히스토리 업데이트
        updated_history = history + [
            {"role": "user", "content": user_utterance},
            {"role": "assistant", "content": answer}
        ]
        
        return {
            "answer": answer,
            "history": updated_history
        }
    
    def invoke(self, user_message: str, history: list = None) -> Dict[str, Any]:
        """그래프 실행 (맥락 분석 포함)"""
        if history is None:
            history = []
        
        # 이전 intent 추출
        last_intent = None
        for msg in reversed(history):
            if msg.get("role") == "user":
                last_intent = self._extract_intent(msg.get("content", ""))
                break
        
        initial_state: CallState = {
            "recent_user_utterance": user_message,
            "history": history,
            "retrieved_docs": [],
            "answer": "",
            "context_decision": None,
            "current_intent": None,
            "last_intent": last_intent,
            "importance_score": None,
            "decision_reason": None,
            "should_generate": None
        }
        
        result = self.graph.invoke(initial_state)
        
        # SKIP된 경우 처리
        if result.get("context_decision") == "SKIP":
            # 간단한 확인 응답만 반환 (히스토리 업데이트 없음)
            return {
                "answer": "",  # 빈 답변
                "sources": [],
                "history": history,  # 히스토리 변경 없음
                "skipped": True,
                "reason": result.get("decision_reason", "unknown")
            }
        
        # GENERATE된 경우
        return {
            "answer": result["answer"],
            "sources": [
                {
                    "content": doc["content"][:200] + "...",  # 미리보기
                    "page": doc["metadata"].get("page", "N/A"),
                    "score": doc["score"]
                }
                for doc in result["retrieved_docs"]
            ],
            "history": result["history"],
            "skipped": False,
            "reason": result.get("decision_reason", "generated")
        }

