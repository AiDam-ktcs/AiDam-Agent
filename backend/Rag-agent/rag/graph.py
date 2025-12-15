"""LangGraph를 사용한 RAG 플로우 정의"""
import os
from typing import Dict, Any
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
9. 정보 확인이나 처리가 필요한 경우, 막연히 "확인이 필요합니다"가 아니라 구체적으로 무엇을 어떻게 확인할지 바로 요청하세요.
   예: "신원 확인이 필요합니다" (X) → "성함과 생년월일을 말씀해주시겠어요?" (O)
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
        """LangGraph 플로우 구축"""
        workflow = StateGraph(CallState)
        
        # 노드 추가
        workflow.add_node("retrieve", self._retrieve_documents)
        workflow.add_node("generate", self._generate_answer)
        
        # 엣지 정의
        workflow.set_entry_point("retrieve")
        workflow.add_edge("retrieve", "generate")
        workflow.add_edge("generate", END)
        
        return workflow.compile()
    
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
        """그래프 실행"""
        if history is None:
            history = []
        
        initial_state: CallState = {
            "recent_user_utterance": user_message,
            "history": history,
            "retrieved_docs": [],
            "answer": ""
        }
        
        result = self.graph.invoke(initial_state)
        
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
            "history": result["history"]
        }

