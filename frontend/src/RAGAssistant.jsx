import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import './rag-assistant-styles.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

// 키워드 태그 데이터
const KEYWORD_TAGS = [
  { id: 1, label: '#가격', query: '가격 문의' },
  { id: 2, label: '#요금제', query: '요금제 변경' },
  { id: 3, label: '#데이터 사용량', query: '데이터 사용량' },
  { id: 4, label: '#배송', query: '배송 조회' },
  { id: 5, label: '#반품', query: '반품 절차' },
  { id: 6, label: '#환불', query: '환불 정책' },
  { id: 7, label: '#결제', query: '결제 오류' },
  { id: 8, label: '#쿠폰', query: '쿠폰 사용' }
]

export default function RAGAssistant({ messages: conversationMessages }) {
  const [scripts, setScripts] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState([])
  const [selectedTag, setSelectedTag] = useState(null)
  const [expandedSources, setExpandedSources] = useState({})
  const scriptsEndRef = useRef(null)

  const scrollToBottom = () => {
    scriptsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [scripts])

  // 태그 클릭 시 해당 키워드로 검색
  const handleTagClick = async (tag) => {
    if (loading) return
    
    setSelectedTag(tag.id)
    await fetchScript(tag.query)
  }

  // 스크립트 요청
  const fetchScript = async (query) => {
    if (!query.trim() || loading) return

    setLoading(true)

    try {
      const response = await axios.post(`${API_URL}/rag/chat`, {
        message: query,
        history: history
      })

      const newScript = {
        id: Date.now(),
        title: query,
        content: response.data.answer,
        sources: response.data.sources || []
      }
      
      setScripts(prev => [...prev, newScript])
      setHistory(response.data.history)

    } catch (error) {
      console.error('RAG Error:', error)
      const errorScript = {
        id: Date.now(),
        title: query,
        content: error.response?.status === 503 
          ? 'RAG Agent가 실행 중이지 않습니다. 상담 가이드 기능을 사용할 수 없습니다.'
          : '죄송합니다. 현재 시스템 문제로 응답을 생성할 수 없습니다.',
        sources: [],
        isError: true
      }
      setScripts(prev => [...prev, errorScript])
    } finally {
      setLoading(false)
    }
  }

  const handleSend = async () => {
    if (!input.trim() || loading) return
    
    const query = input.trim()
    setInput('')
    await fetchScript(query)
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearScripts = () => {
    setScripts([])
    setHistory([])
    setSelectedTag(null)
    setExpandedSources({})
  }

  const toggleSource = (scriptId, sourceIdx) => {
    const key = `${scriptId}-${sourceIdx}`
    setExpandedSources(prev => ({
      ...prev,
      [key]: !prev[key]
    }))
  }

  const useScript = (content) => {
    // 스크립트를 클립보드에 복사
    navigator.clipboard.writeText(content)
    alert('스크립트가 클립보드에 복사되었습니다.')
  }

  return (
    <div className="rag-container">
      {/* Header */}
      <div className="rag-header">
        <h2>AI 추천 스크립트</h2>
        {scripts.length > 0 && (
          <button className="clear-btn" onClick={clearScripts}>
            <span className="material-icons-outlined">refresh</span>
            초기화
          </button>
        )}
      </div>

      {/* Tag Chips */}
      <div className="tag-chips">
        {KEYWORD_TAGS.map(tag => (
          <button
            key={tag.id}
            className={`tag-chip ${selectedTag === tag.id ? 'active' : ''}`}
            onClick={() => handleTagClick(tag)}
            disabled={loading}
          >
            {tag.label}
          </button>
        ))}
      </div>

      {/* Scripts List */}
      <div className="scripts-container">
        {scripts.length === 0 && !loading && (
          <div className="empty-scripts">
            <span className="material-icons-outlined">auto_awesome</span>
            <p><strong>실시간 상담 가이드</strong></p>
            <p>태그를 클릭하거나 질문을 입력하시면</p>
            <p>AI가 상담 스크립트를 추천해드립니다.</p>
          </div>
        )}

        {scripts.map((script, idx) => (
          <div 
            key={script.id} 
            className={`script-card ${idx === 0 ? 'highlight' : ''} ${script.isError ? 'error' : ''}`}
          >
            <h3 className="script-title">
              {idx + 1}. {script.title}
            </h3>
            <p className="script-content">{script.content}</p>
            
            <div className="script-footer">
              <button 
                className="use-script-btn"
                onClick={() => useScript(script.content)}
              >
                스크립트 사용
              </button>
              
              {script.sources && script.sources.length > 0 && (
                <div className="source-links">
                  {script.sources.map((source, sourceIdx) => {
                    const key = `${script.id}-${sourceIdx}`
                    const isExpanded = expandedSources[key]
                    
                    return (
                      <div key={sourceIdx} className="source-item">
                        <button 
                          className="source-link"
                          onClick={() => toggleSource(script.id, sourceIdx)}
                        >
                          <span className="material-icons-outlined source-icon">
                            {source.page ? 'picture_as_pdf' : 'description'}
                          </span>
                          <span>
                            {source.page && source.page !== 'N/A' 
                              ? `매뉴얼 p.${source.page}` 
                              : '참조 문서'}
                          </span>
                          <span className="material-icons-outlined expand-icon">
                            {isExpanded ? 'expand_less' : 'expand_more'}
                          </span>
                        </button>
                        
                        {isExpanded && (
                          <div className="source-content">
                            {source.content}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="script-card loading">
            <div className="loading-content">
              <div className="loader"></div>
              <span>스크립트 생성 중...</span>
            </div>
          </div>
        )}

        <div ref={scriptsEndRef} />
      </div>

      {/* Input Area */}
      <div className="input-container">
        <input
          type="text"
          className="script-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="고객 문의 내용을 입력하세요..."
          disabled={loading}
        />
        <button
          className="send-btn"
          onClick={handleSend}
          disabled={loading || !input.trim()}
        >
          <span className="material-icons-outlined">send</span>
        </button>
      </div>
    </div>
  )
}
