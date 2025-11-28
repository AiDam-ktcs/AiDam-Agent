import React, { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

export default function AgentDashboard() {
  const [view, setView] = useState('main') // 'main', 'history', 'samples'
  const [messages, setMessages] = useState([])
  const [processing, setProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState(0)
  const [processingMessage, setProcessingMessage] = useState('')
  const [currentReport, setCurrentReport] = useState(null)
  const [reports, setReports] = useState([])
  const [selectedReportId, setSelectedReportId] = useState(null)
  const [autoAnalyze, setAutoAnalyze] = useState(true)
  const [callStatus, setCallStatus] = useState('idle') // 'idle', 'ringing', 'active', 'ended'
  const [currentPhoneNumber, setCurrentPhoneNumber] = useState('010-1234-5678') // 현재 통화 중인 고객 번호
  const [sampleList] = useState([
    { id: 0, title: '인터넷 장애 - 긴급 문의' },
    { id: 1, title: '통화품질 불량 - 유심 교체' },
    { id: 2, title: '요금제 변경 - 데이터 절약' },
    { id: 3, title: '청구서 이상 - 부가서비스 항의' },
    { id: 4, title: '기기 변경 - 아이폰 구매' },
    { id: 5, title: '데이터 차단 - 추가 구매' },
    { id: 6, title: '해외 로밍 - 일본 여행' },
    { id: 7, title: '명의 도용 오해 - 미납 발견' },
    { id: 8, title: '5G 커버리지 불만' },
    { id: 9, title: '어르신 요금제 - 효도 상담' }
  ])

  useEffect(() => {
    loadReports()
    // 자동으로 최신 보고서 로드
    if (reports.length > 0 && !selectedReportId) {
      viewReport(reports[0].id)
    }
  }, [])

  const loadReports = async () => {
    try {
      const resp = await fetch(`${API_URL}/reports`)
      const data = await resp.json()
      setReports(data.reports || [])
    } catch (err) {
      console.error('Failed to load reports:', err)
    }
  }

  const parseMessages = (text) => {
    const lines = text.trim().split('\n')
    const msgs = []
    
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      
      // Try to parse as "role: content" format
      const match = trimmed.match(/^(user|assistant|system):\s*(.+)$/i)
      if (match) {
        msgs.push({
          role: match[1].toLowerCase(),
          content: match[2].trim()
        })
      } else if (msgs.length > 0) {
        // Append to last message
        msgs[msgs.length - 1].content += '\n' + trimmed
      } else {
        // First line without role prefix, assume user
        msgs.push({
          role: 'user',
          content: trimmed
        })
      }
    }
    
    return msgs
  }

  const loadSampleConversation = async (sampleId) => {
    try {
      const resp = await fetch(`/sample-conversations/conversation${sampleId}.json`)
      const data = await resp.json()
      setMessages(data)
      setCurrentReport(null)
      setView('main')
    } catch (err) {
      console.error('Failed to load sample:', err)
      alert('샘플 대화를 불러오는데 실패했습니다.')
    }
  }

  const showSampleList = () => {
    setView('samples')
  }

  const handleProcess = async () => {
    if (messages.length === 0) {
      alert('분석할 대화가 없습니다. 먼저 대화를 불러와주세요.')
      return
    }

    setProcessing(true)
    setProcessingStep(0)
    setProcessingMessage('보고서 생성을 준비하고 있습니다...')

    try {
      const response = await fetch(`${API_URL}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: messages,
          metadata: {
            source: 'auto_analysis',
            uploaded_at: new Date().toISOString()
          }
        })
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || `서버 오류 (${response.status})`)
      }

      // Read SSE stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6))
              
              if (data.step === -1) {
                // Error occurred
                throw new Error(data.error || '보고서 생성 중 오류가 발생했습니다.')
              }
              
              setProcessingStep(data.step)
              setProcessingMessage(data.message)

              // Final step with complete data
              if (data.step === 5 && data.data) {
                const result = data.data
                setCurrentReport(result)
                setSelectedReportId(result.reportId)
                await loadReports()
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError)
              // Continue processing other lines
            }
          }
        }
      }

      setProcessing(false)
    } catch (err) {
      console.error('Process error:', err)
      const errorMessage = err.message || '보고서 생성 중 오류가 발생했습니다.'
      
      // Show user-friendly error message
      alert(`❌ 오류 발생\n\n${errorMessage}\n\n백엔드 서버가 실행 중인지 확인해주세요.`)
      
      setProcessing(false)
      setProcessingStep(0)
      setProcessingMessage('')
    }
  }

  const viewReport = async (reportId) => {
    try {
      const resp = await fetch(`${API_URL}/reports/${reportId}`)
      const data = await resp.json()
      
      if (data.success) {
        setCurrentReport({
          reportId: data.report.id,
          analysis: data.report.analysis,
          report: data.report.content,
          created_at: data.report.created_at
        })
        setMessages(data.report.messages || [])
        setSelectedReportId(reportId)
        setView('main')
      }
    } catch (err) {
      console.error('Failed to load report:', err)
      alert('Failed to load report')
    }
  }

  const deleteReport = async (reportId, e) => {
    e.stopPropagation()
    
    if (!confirm('Delete this report?')) return
    
    try {
      const resp = await fetch(`${API_URL}/reports/${reportId}`, {
        method: 'DELETE'
      })
      
      if (resp.ok) {
        await loadReports()
        if (currentReport && currentReport.reportId === reportId) {
          setCurrentReport(null)
          setMessages([])
          setSelectedReportId(null)
        }
      }
    } catch (err) {
      console.error('Failed to delete report:', err)
      alert('Failed to delete report')
    }
  }

  const clearCurrentConversation = () => {
    setMessages([])
    setCurrentReport(null)
    setSelectedReportId(null)
  }

  const addMessage = (role, content) => {
    setMessages(prev => [...prev, { role, content }])
  }

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target.result
        
        // Try to parse as JSON first (exported chat format)
        try {
          const json = JSON.parse(text)
          if (Array.isArray(json) && json[0]?.role && json[0]?.content) {
            setMessages(json)
            return
          }
        } catch {}
        
        // Otherwise treat as plain text
        const parsed = parseMessages(text)
        if (parsed.length > 0) {
          setMessages(parsed)
        }
      } catch (err) {
        alert('Failed to read file')
      }
    }
    reader.readAsText(file)
  }

  const exportMessages = () => {
    const dataStr = JSON.stringify(messages, null, 2)
    const dataBlob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(dataBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = `conversation_${Date.now()}.json`
    link.click()
  }

  return (
    <div className="agent-app">
      {/* Unified Header */}
      <header className="unified-header">
        <div className="header-left">
          <h1>AiDam Agent</h1>
          <span className="subtitle">고객 상담 분석 시스템</span>
        </div>
        
        <div className="header-center">
          <div className="call-info">
            <span className={`status-indicator status-${callStatus}`}></span>
            <span className="status-text">
              {callStatus === 'idle' && '대기 중'}
              {callStatus === 'ringing' && '수신 중'}
              {callStatus === 'active' && '통화 중'}
              {callStatus === 'ended' && '통화 종료'}
            </span>
            {callStatus === 'active' && (
              <span className="phone-number">📞 {currentPhoneNumber}</span>
            )}
          </div>
          {messages.length > 0 && (
            <span className="message-count">
              {messages.length}개 메시지 (고객 {messages.filter(m => m.role === 'user').length} / 상담사 {messages.filter(m => m.role === 'assistant').length})
            </span>
          )}
        </div>

        <div className="header-right">
          <button className="call-btn" disabled={callStatus === 'idle'}>
            📞 통화 종료
          </button>
          <div className="recording-indicator">
            <span className="rec-dot"></span>
            <span>녹음중</span>
          </div>
          <button 
            className={`header-btn ${view === 'history' ? 'active' : ''}`}
            onClick={() => setView(view === 'history' ? 'main' : 'history')}
          >
            히스토리 ({reports.length})
          </button>
        </div>
      </header>

      <main className="agent-main">
        {view === 'main' && (
          <div className="three-panel-view">
            {/* 좌측: 채팅 UI */}
            <div className="left-panel chat-panel">
              <div className="panel-header">
                <h2>고객 상담 대화</h2>
                <div className="panel-actions">
                  {messages.length > 0 && (
                    <>
                      <button onClick={exportMessages} className="icon-btn" title="내보내기">
                        💾
                      </button>
                      <button onClick={clearCurrentConversation} className="icon-btn" title="초기화">
                        🔄
                      </button>
                    </>
                  )}
                </div>
              </div>

              {messages.length === 0 ? (
                <div className="empty-chat">
                  <div className="empty-icon">💬</div>
                  <p>상담 대화가 표시됩니다</p>
                  <div className="empty-actions">
                    <button onClick={showSampleList} className="sample-btn">
                      📝 샘플 대화 불러오기
                    </button>
                    <label className="sample-btn">
                      📁 파일에서 불러오기
                      <input type="file" accept=".txt,.json" onChange={handleFileUpload} hidden />
                    </label>
                  </div>
                </div>
              ) : (
                <>
                  <div className="chat-messages">
                    {messages.map((msg, idx) => (
                      <div key={idx} className={`chat-message ${msg.role}`}>
                        <div className="message-avatar">
                          {msg.role === 'user' ? '👤' : '🎧'}
                        </div>
                        <div className="message-bubble">
                          <div className="message-author">
                            {msg.role === 'user' ? '고객' : '상담사'}
                          </div>
                          <div className="message-text">{msg.content}</div>
                          <div className="message-time">
                            {new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 가운데: AI 실시간 분석 (향후 구현) */}
            <div className="center-panel ai-assistant-panel">
              <div className="panel-header">
                <h2>AI 어시스턴트</h2>
              </div>
              
              <div className="ai-content">
                <div className="ai-placeholder">
                  <div className="placeholder-icon">🔮</div>
                  <h3>실시간 AI 분석</h3>
                  <p>통화 중 실시간으로:</p>
                  <ul className="feature-list">
                    <li>핵심 키워드 추출</li>
                    <li>추천 응답 제시 (RAG)</li>
                    <li>스크립트 가이드</li>
                    <li>즉각적인 반응</li>
                  </ul>
                  <p className="coming-soon">Coming Soon...</p>
                </div>
              </div>
            </div>

            {/* 우측: 보고서 */}
            <div className="right-panel report-panel">
              <div className="panel-header">
                <h2>상담 보고서</h2>
                {messages.length > 0 && !processing && (
                  <button onClick={handleProcess} className="generate-report-btn">
                    보고서 생성
                  </button>
                )}
              </div>

              {processing && (
                <div className="report-loading">
                  <div className="loading-header">
                    <div className="loading-spinner"></div>
                    <h3>보고서 생성 중...</h3>
                  </div>
                  
                  <div className="progress-container">
                    <div className="progress-bar-track">
                      <div 
                        className="progress-bar-fill" 
                        style={{ width: `${(processingStep / 5) * 100}%` }}
                      ></div>
                    </div>
                    
                    <div className="progress-steps">
                      <div className={`progress-step ${processingStep >= 1 ? 'active' : ''} ${processingStep > 1 ? 'completed' : ''}`}>
                        <div className="step-icon">{processingStep > 1 ? '✓' : '📝'}</div>
                        <div className="step-label">준비</div>
                        <div className="step-description">대화 데이터 로드</div>
                      </div>
                      
                      <div className="progress-line"></div>
                      
                      <div className={`progress-step ${processingStep >= 2 ? 'active' : ''} ${processingStep > 2 ? 'completed' : ''}`}>
                        <div className="step-icon">{processingStep > 2 ? '✓' : '🔍'}</div>
                        <div className="step-label">분석</div>
                        <div className="step-description">AI 대화 분석</div>
                      </div>
                      
                      <div className="progress-line"></div>
                      
                      <div className={`progress-step ${processingStep >= 3 ? 'active' : ''} ${processingStep > 3 ? 'completed' : ''}`}>
                        <div className="step-icon">{processingStep > 3 ? '✓' : '📊'}</div>
                        <div className="step-label">보고서 생성</div>
                        <div className="step-description">상세 리포트 작성</div>
                      </div>
                      
                      <div className="progress-line"></div>
                      
                      <div className={`progress-step ${processingStep >= 4 ? 'active' : ''} ${processingStep > 4 ? 'completed' : ''}`}>
                        <div className="step-icon">{processingStep > 4 ? '✓' : '💾'}</div>
                        <div className="step-label">저장</div>
                        <div className="step-description">보고서 저장</div>
                      </div>
                      
                      <div className="progress-line"></div>
                      
                      <div className={`progress-step ${processingStep >= 5 ? 'active completed' : ''}`}>
                        <div className="step-icon">✅</div>
                        <div className="step-label">완료</div>
                        <div className="step-description">처리 완료</div>
                      </div>
                    </div>
                    
                    <div className="progress-status">
                      <div className="status-message">{processingMessage}</div>
                      <div className="status-info">단계 {processingStep} / 5</div>
                    </div>
                  </div>
                </div>
              )}

              {!processing && !currentReport && (
                <div className="empty-report">
                  <div className="empty-icon">📋</div>
                  <p>보고서가 아직 생성되지 않았습니다.</p>
                  <p className="empty-help">
                    상담이 종료되면<br/>
                    "보고서 생성" 버튼을 클릭하세요.
                  </p>
                </div>
              )}

              {!processing && currentReport && (
                <div className="report-content">
                  {/* 분석 요약 카드 */}
                  <div className="summary-cards">
                    <div className="summary-card">
                      <div className="card-label">전체 요약</div>
                      <div className="card-value">{currentReport.analysis?.summary}</div>
                    </div>
                    
                    <div className="summary-card">
                      <div className="card-label">감정 분석</div>
                      <div className="card-value">
                        <span className={`sentiment-badge ${currentReport.analysis?.sentiment}`}>
                          {currentReport.analysis?.sentiment === 'positive' ? '😊 긍정적' :
                           currentReport.analysis?.sentiment === 'negative' ? '😞 부정적' :
                           currentReport.analysis?.sentiment === 'mixed' ? '😐 복합적' : '😶 중립적'}
                        </span>
                      </div>
                    </div>

                    <div className="summary-card">
                      <div className="card-label">주요 주제</div>
                      <div className="card-value">
                        <div className="topic-tags">
                          {currentReport.analysis?.main_topics?.map((topic, i) => (
                            <span key={i} className="topic-tag">{topic}</span>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="summary-card">
                      <div className="card-label">통계</div>
                      <div className="card-value stats-grid">
                        <div className="stat-item">
                          <span className="stat-label">전체</span>
                          <span className="stat-number">{currentReport.analysis?.statistics?.total_messages}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">고객</span>
                          <span className="stat-number">{currentReport.analysis?.statistics?.user_messages}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">상담사</span>
                          <span className="stat-number">{currentReport.analysis?.statistics?.assistant_messages}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">평균 길이</span>
                          <span className="stat-number">{currentReport.analysis?.statistics?.average_message_length}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 상세 보고서 */}
                  <div className="detailed-report">
                    <h3>📝 상세 보고서</h3>
                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {currentReport.report}
                      </ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {view === 'history' && (
          <div className="history-view">
            <div className="history-header">
              <h2>📚 보고서 히스토리</h2>
              <button onClick={() => setView('main')} className="secondary-btn">
                ← 돌아가기
              </button>
            </div>
            
            {reports.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📚</div>
                <p>저장된 보고서가 없습니다</p>
              </div>
            ) : (
              <div className="report-list">
                {reports.map(report => (
                  <div key={report.id} className="report-item">
                    <div className="report-header-row">
                      <div className="report-info">
                        <h3>{report.id}</h3>
                        <span className="report-date">{new Date(report.timestamp).toLocaleString('ko-KR')}</span>
                      </div>
                      <div className="report-actions">
                        <button 
                          onClick={() => viewReport(report.id)}
                          className="view-btn"
                        >
                          보기
                        </button>
                        <button 
                          onClick={() => deleteReport(report.id)}
                          className="delete-btn"
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                    {report.analysis && (
                      <div className="report-preview">
                        <span className="preview-label">주요 토픽:</span>
                        <span className="preview-text">{report.analysis.main_topics?.join(', ')}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === 'samples' && (
          <div className="samples-view">
            <div className="samples-header">
              <h2>샘플 대화 목록</h2>
              <button onClick={() => setView('main')} className="secondary-btn">
                ← 돌아가기
              </button>
            </div>
            
            <div className="sample-list">
              {sampleList.map(sample => (
                <div 
                  key={sample.id} 
                  className="sample-item"
                  onClick={() => loadSampleConversation(sample.id)}
                >
                  <div className="sample-number">#{sample.id}</div>
                  <div className="sample-info">
                    <h3 className="sample-title">{sample.title}</h3>
                  </div>
                  <div className="sample-arrow">→</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

