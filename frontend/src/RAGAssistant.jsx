import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import './rag-assistant-styles.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

// 더미 키워드 데이터
const DUMMY_KEYWORDS = [
  '요금제 변경',
  '배송 조회',
  '반품 절차',
  '환불 정책',
  '회원 가입',
  '비밀번호 재설정',
  '포인트 적립',
  '쿠폰 사용',
  '결제 오류',
  '주문 취소'
]

export default function RAGAssistant({ messages: conversationMessages }) {
  const [ragMessages, setRagMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [expandedSources, setExpandedSources] = useState({}) // 확장/축소 상태
  const messagesEndRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [ragMessages])

  // 대화 메시지가 추가될 때 자동으로 가이드 요청 (선택적 기능)
  useEffect(() => {
    if (conversationMessages && conversationMessages.length > 0) {
      const lastMessage = conversationMessages[conversationMessages.length - 1]
      if (lastMessage.role === 'user') {
        // 자동 가이드 요청 (옵션)
        // handleAutoGuide(lastMessage.content)
      }
    }
  }, [conversationMessages])

  const handleSend = async () => {
    if (!input.trim() || loading) return

    const userMessage = input.trim()
    setInput('')
    setLoading(true)

    // 사용자 메시지 추가
    const newUserMessage = {
      role: 'user',
      content: userMessage,
      sources: []
    }
    setRagMessages(prev => [...prev, newUserMessage])

    try {
      // 메인 백엔드를 통해 RAG Agent 호출
      const response = await axios.post(`${API_URL}/rag/chat`, {
        message: userMessage,
        history: history
      })

      // 응답 메시지 추가
      const assistantMessage = {
        role: 'assistant',
        content: response.data.answer,
        sources: response.data.sources
      }
      setRagMessages(prev => [...prev, assistantMessage])
      setHistory(response.data.history)

    } catch (error) {
      console.error('RAG Error:', error)
      const errorMessage = {
        role: 'assistant',
        content: error.response?.status === 503 
          ? 'RAG Agent가 실행 중이지 않습니다. 상담 가이드 기능을 사용할 수 없습니다.'
          : '죄송합니다. 현재 시스템 문제로 응답을 생성할 수 없습니다.',
        sources: []
      }
      setRagMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearChat = () => {
    setRagMessages([])
    setHistory([])
    setExpandedSources({}) // 확장 상태도 초기화
  }

  // 출처 확장/축소 토글
  const toggleSource = (msgIdx, sourceIdx) => {
    const key = `${msgIdx}-${sourceIdx}`
    setExpandedSources(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  // 키워드 클릭 시 매뉴얼만 검색
  const handleKeywordClick = async (keyword) => {
    if (loading) return

    setLoading(true)

    try {
      // 매뉴얼 검색 API 호출 (LLM 답변 생성 없이)
      const response = await axios.post(`${API_URL}/rag/search`, {
        query: keyword,
        k: 2 // 가장 관련도 높은 1~2개 매뉴얼만 가져오기
      })

      // 매뉴얼만 표시 (고객 발화, AI 응답 없이)
      const manualMessage = {
        role: 'manual', // 매뉴얼 전용 타입
        content: `📖 "${keyword}" 관련 매뉴얼`,
        sources: response.data.sources || []
      }
      setRagMessages(prev => [...prev, manualMessage])

    } catch (error) {
      console.error('Manual Search Error:', error)
      const errorMessage = {
        role: 'manual',
        content: `"${keyword}" 매뉴얼 검색 실패`,
        sources: [],
        error: true
      }
      setRagMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }


  return (
    <div className="rag-assistant-container">
      <div className="rag-header">
        <h3>🤖 AI 상담 가이드</h3>
        {ragMessages.length > 0 && (
          <button className="clear-button" onClick={clearChat}>
            대화 초기화
          </button>
        )}
      </div>

      {/* 키워드 리스트 */}
      <div className="keyword-list-container">
        <div className="keyword-list">
          {DUMMY_KEYWORDS.map((keyword, idx) => (
            <div
              key={idx}
              className="keyword-chip"
              onClick={() => handleKeywordClick(keyword)}
            >
              {keyword}
            </div>
          ))}
        </div>
      </div>

      <div className="rag-messages-container">
        {ragMessages.length === 0 && (
          <div className="rag-welcome-message">
            <p>🎯 <strong>실시간 상담 가이드</strong></p>
            <p>고객 발화를 입력하시면 내부 매뉴얼 기반으로</p>
            <p>상담 가이드를 제공해드립니다.</p>
          </div>
        )}

        {ragMessages.map((msg, idx) => (
          <div
            key={idx}
            className={`rag-message ${
              msg.role === 'user' ? 'rag-message-user' : 
              msg.role === 'manual' ? 'rag-message-manual' : 
              'rag-message-assistant'
            }`}
          >
            <div className="rag-message-content">
              {msg.role !== 'manual' && (
                <>
                  <div className="rag-message-header">
                    {msg.role === 'user' ? '👤 고객 발화' : '🤖 AIDAM 가이드'}
                  </div>
                  <div className="rag-message-text">{msg.content}</div>
                </>
              )}
              {msg.role === 'manual' && (
                <div className="rag-manual-header">{msg.content}</div>
              )}
              {msg.sources && msg.sources.length > 0 && (
                <div className="rag-message-sources">
                  {msg.role !== 'manual' && (
                    <div className="rag-sources-title">📚 참고 매뉴얼</div>
                  )}
                  {msg.sources.map((source, sourceIdx) => {
                    const sourceKey = `${idx}-${sourceIdx}`
                    const isExpanded = expandedSources[sourceKey]
                    
                    return (
                      <div key={sourceIdx} className="rag-source-item">
                        <div className="rag-source-content-wrapper">
                          <span className={`rag-source-preview ${isExpanded ? 'expanded' : 'collapsed'}`}>
                            {source.content}
                          </span>
                          <div className="rag-source-footer">
                            {source.page && source.page !== 'N/A' && (
                              <span className="rag-source-page">p.{source.page}</span>
                            )}
                            <button 
                              className="rag-source-toggle"
                              onClick={() => toggleSource(idx, sourceIdx)}
                            >
                              {isExpanded ? '접기 ▲' : '더보기 ▼'}
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {msg.error && msg.sources.length === 0 && (
                <div className="rag-error-message">매뉴얼을 찾을 수 없습니다.</div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="rag-message rag-message-assistant">
            <div className="rag-message-content">
              <div className="rag-message-header">🤖 AIDAM 가이드</div>
              <div className="rag-loading-indicator">
                <span className="loading-dots">답변 생성 중</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="rag-input-container">
        <textarea
          className="rag-input-field"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="고객 발화를 입력하세요... (Enter로 전송)"
          rows={2}
          disabled={loading}
        />
        <button
          className="rag-send-button"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          {loading ? '...' : '전송'}
        </button>
      </div>
    </div>
  )
}

