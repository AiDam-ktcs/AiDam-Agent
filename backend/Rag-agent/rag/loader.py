"""PDF 로더 및 벡터 스토어 구축"""
import os
from pathlib import Path
from typing import List, Dict, Any
from pypdf import PdfReader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from dotenv import load_dotenv

load_dotenv()


class PDFRAGLoader:
    """PDF 파일을 로드하고 벡터 스토어를 구축하는 클래스"""
    
    def __init__(self, pdf_path: str = "./내부_상담_메뉴얼.pdf"):
        self.pdf_path = pdf_path
        self.vector_store = None
        self.embeddings = None
        
    def load_and_index(self) -> FAISS:
        """PDF를 로드하고 벡터 스토어를 구축"""
        # PDF 파일 존재 확인
        if not os.path.exists(self.pdf_path):
            raise FileNotFoundError(
                f"PDF 파일을 찾을 수 없습니다: {self.pdf_path}\n"
                f"현재 작업 디렉토리: {os.getcwd()}"
            )
        
        print(f"PDF 파일 로딩 중: {self.pdf_path}")
        
        # PDF 로드 (pypdf 직접 사용)
        reader = PdfReader(self.pdf_path)
        documents = []
        for i, page in enumerate(reader.pages):
            text = page.extract_text()
            if text.strip():  # 빈 페이지 제외
                documents.append(Document(
                    page_content=text,
                    metadata={"page": i + 1, "source": self.pdf_path}
                ))
        
        print(f"로드된 문서 수: {len(documents)} 페이지")
        
        # 텍스트 분할
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
        )
        chunks = text_splitter.split_documents(documents)
        
        print(f"총 {len(chunks)}개의 청크로 분할됨")
        
        # Embedding 모델 초기화
        embedding_model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
        self.embeddings = OpenAIEmbeddings(
            model=embedding_model,
            openai_api_key=os.getenv("OPENAI_API_KEY")
        )
        
        # 벡터 스토어 구축
        print("벡터 스토어 구축 중...")
        self.vector_store = FAISS.from_documents(chunks, self.embeddings)
        
        print("벡터 스토어 구축 완료!")
        return self.vector_store
    
    def search(self, query: str, k: int = 3) -> List[Dict[str, Any]]:
        """벡터 스토어에서 관련 문서 검색"""
        if self.vector_store is None:
            raise ValueError("벡터 스토어가 초기화되지 않았습니다. load_and_index()를 먼저 호출하세요.")
        
        docs = self.vector_store.similarity_search_with_score(query, k=k)
        
        results = []
        for doc, score in docs:
            results.append({
                "content": doc.page_content,
                "metadata": doc.metadata,
                "score": float(score)
            })
        
        return results

