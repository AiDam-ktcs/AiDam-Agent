import React, { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import RAGAssistant from './RAGAssistant'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

const UPSELL_AGENT_URL = 'http://localhost:8008'

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
  const [callStatus, setCallStatus] = useState('active') // 'idle', 'ringing', 'active', 'ended'
  const [currentPhoneNumber, setCurrentPhoneNumber] = useState('010-1111-2222')
  const [volume, setVolume] = useState(50)
  const [isMuted, setIsMuted] = useState(false)
  const [isPaused, setIsPaused] = useState(false)
  const [rightPanelTab, setRightPanelTab] = useState('intent') // 'intent', 'report'

  // 고객 정보 (Backend Integration)
  const [customerInfo, setCustomerInfo] = useState(null)

  // Call Status Polling
  useEffect(() => {
    const pollCallStatus = async () => {
      try {
        const resp = await fetch(`${API_URL}/active-call`)
        const data = await resp.json()
        if (data.active && data.call) {
          setCallStatus('active')
          setCustomerInfo({
            name: data.call.customer['이름'] || 'Unknown',
            phone: data.call.customer['번호'],
            plan: data.call.customer['요금제'] || 'Unknown',
            age: data.call.customer['나이'],
            usage: {
              prev: data.call.customer['전월 데이터'],
              curr: data.call.customer['현월 데이터']
            }
          })
          setCurrentPhoneNumber(data.call.customer['번호'])
        } else if (callStatus === 'active') { // Call ended externally
          // Optional: Handle external call end
        }
      } catch (err) {
        console.error('Failed to poll call status:', err)
      }
    }

    const interval = setInterval(pollCallStatus, 2000)
    return () => clearInterval(interval)
  }, [callStatus])

  // 추천 요금제 (AI가 분석해서 제공)
  const [recommendedPlans, setRecommendedPlans] = useState([])

  // AI 분석/사고 과정
  const [aiReasoning, setAiReasoning] = useState([])
  const [isAnalyzingIntent, setIsAnalyzingIntent] = useState(false)

  // 선택된 요금제에 대한 추천 스크립트
  const [planScript, setPlanScript] = useState('')
  const [scriptLoading, setScriptLoading] = useState(false)

  // 고객 의중 (AI 분석 결과)
  const [customerIntent, setCustomerIntent] = useState('대화 내용 분석 대기 중...')

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
    if (reports.length > 0 && !selectedReportId) {
      viewReport(reports[0].id)
    }
  }, [])

  // 대화가 업데이트될 때마다 의중 분석 (User 메시지인 경우)
  useEffect(() => {
    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1]
      // 실제로는 assistant 메시지 이후에도 반응할 수 있지만, user 입력에 반응하는 것이 일반적
      if (lastMsg.role === 'user') {
        analyzeIntent()
      }
    }
  }, [messages])

  // AI 의중 분석 (Upsell Agent 연결)
  const analyzeIntent = async () => {
    setIsAnalyzingIntent(true)

    // 분석 시작 시점에는 간단한 상태만 표시 (또는 이전 사고 과정 초기화)
    setAiReasoning(['대화의 맥락을 파악하고 있습니다...'])

    try {
      const payload = {
        conversation_history: messages.map(m => ({ role: m.role, content: m.content })),
        current_plan_name: customerInfo?.plan || 'Unknown',
        current_plan_fee: 35000 // TODO: Fetch from pricing plan
      }

      const response = await fetch(`${UPSELL_AGENT_URL}/analyze/quick`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`)
      }

      const data = await response.json()

      // AI의 실제 사고 과정으로 업데이트
      if (data.reasoning_steps && data.reasoning_steps.length > 0) {
        // 단계별로 표시되는 효과를 위해 순차적으로 업데이트할 수도 있지만,
        // 여기서는 한번에 업데이트하거나, 원한다면 타이머를 둬서 하나씩 보여줄 수 있음.
        // UX상 한번에 보여주는 것이 깔끔할 수 있음 (이미 분석이 끝났으므로)
        setAiReasoning(data.reasoning_steps)
      } else {
        setAiReasoning(['특이사항이 발견되지 않았습니다.'])
      }

      // 상태 업데이트
      setCustomerIntent(data.intent_description || data.customer_intent)

      // 추천 요금제 매핑
      const plans = (data.recommended_plans || []).map((plan, idx) => ({
        id: idx,
        name: plan.plan_name,
        price: plan.monthly_fee.toLocaleString(),
        data: plan.data_limit,
        selected: false
      }))

      setRecommendedPlans(plans)

    } catch (error) {
      console.error('Intent analysis failed:', error)
      setAiReasoning(['분석 서버 연결에 실패했습니다.'])
      setCustomerIntent('시스템 오류 발생')
    } finally {
      setIsAnalyzingIntent(false)
    }
  }

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

      const match = trimmed.match(/^(user|assistant|system):\s*(.+)$/i)
      if (match) {
        msgs.push({
          role: match[1].toLowerCase(),
          content: match[2].trim()
        })
      } else if (msgs.length > 0) {
        msgs[msgs.length - 1].content += '\n' + trimmed
      } else {
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
    setRightPanelTab('report')

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

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6))

              if (data.step === -1) {
                throw new Error(data.error || '보고서 생성 중 오류가 발생했습니다.')
              }

              setProcessingStep(data.step)
              setProcessingMessage(data.message)

              if (data.step === 5 && data.data) {
                const result = data.data
                setCurrentReport(result)
                setSelectedReportId(result.reportId)
                await loadReports()
              }
            } catch (parseError) {
              console.error('Failed to parse SSE data:', parseError)
            }
          }
        }
      }

      setProcessing(false)
    } catch (err) {
      console.error('Process error:', err)
      const errorMessage = err.message || '보고서 생성 중 오류가 발생했습니다.'
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
        setRightPanelTab('report')
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

  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const text = event.target.result

        try {
          const json = JSON.parse(text)
          if (Array.isArray(json) && json[0]?.role && json[0]?.content) {
            setMessages(json)
            return
          }
        } catch { }

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

  const handleEndCall = async () => {
    try {
      await fetch(`${API_URL}/call/end`, { method: 'POST' })
      setCallStatus('ended')
      setCustomerInfo(null)
      setMessages([])
      setCurrentReport(null)
    } catch (err) {
      console.error('Failed to end call:', err)
    }
  }

  // Incoming Call Simulation (Dev Tool)
  const simulateIncomingCall = async () => {
    const phoneNumber = prompt('전화번호를 입력하세요 (예: 010-9093-7189):', '010-9093-7189')
    if (!phoneNumber) return

    try {
      const resp = await fetch(`${API_URL}/stt/incoming-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phoneNumber })
      })
      const data = await resp.json()
      if (data.success) {
        setCallStatus('ringing')
        // Automatically answer for demo purposes after 1.5s
        setTimeout(() => setCallStatus('active'), 1500)
      }
    } catch (err) {
      alert('오류 발생: ' + err.message)
    }
  }

  // 요금제 선택 핸들러
  const handlePlanSelect = async (planId) => {
    // 선택 상태 업데이트
    setRecommendedPlans(prev => prev.map(plan => ({
      ...plan,
      selected: plan.id === planId
    })))

    const selectedPlan = recommendedPlans.find(p => p.id === planId)
    if (!selectedPlan) return

    // 스크립트 생성 요청
    setScriptLoading(true)
    setPlanScript('')

    try {
      // 현재 대화 맥락을 포함한 스크립트 생성 요청
      const response = await fetch(`${API_URL}/rag/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `고객에게 "${selectedPlan.name}" 요금제(월 ${selectedPlan.price}원, ${selectedPlan.data})를 추천하는 스크립트를 작성해주세요. 현재 대화 맥락을 고려해서 자연스럽게 제안하는 멘트를 만들어주세요.`,
          history: messages.map(m => ({ role: m.role, content: m.content }))
        })
      })

      const data = await response.json()
      setPlanScript(data.answer || '스크립트를 생성할 수 없습니다.')
    } catch (error) {
      console.error('Script generation error:', error)
      setPlanScript(`고객님, 현재 사용량을 분석해본 결과 "${selectedPlan.name}" 요금제가 가장 적합해 보입니다. 월 ${selectedPlan.price}원에 ${selectedPlan.data}가 제공되어 현재보다 더 합리적으로 이용하실 수 있습니다. 변경을 도와드릴까요?`)
    } finally {
      setScriptLoading(false)
    }
  }

  // 키워드 하이라이트 함수
  const highlightKeywords = (text, keywords = ['비싸', '비싸요', '너무']) => {
    let result = text
    keywords.forEach(keyword => {
      const regex = new RegExp(`(${keyword})`, 'gi')
      result = result.replace(regex, `<span class="keyword-highlight">$1</span>`)
    })
    return result
  }

  return (
    <div className="agent-app">
      {/* Header */}
      <header className="main-header">
        <div className="header-left">
          <h1 className="app-title">AiDam</h1>
          <div className="header-divider"></div>
          <button
            className="end-call-btn"
            onClick={handleEndCall}
            disabled={callStatus === 'ended' || callStatus === 'idle'}
          >
            <span className="material-icons-outlined">call_end</span>
            <span>End Call</span>
          </button>
          {/* Dev Tool: Simulate Call */}
          <button
            className="sim-call-btn"
            onClick={simulateIncomingCall}
            style={{ marginLeft: '10px', padding: '5px 10px', background: '#444', border: 'none', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}
          >
            <span className="material-icons-outlined" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '4px' }}>ring_volume</span>
            Simulate Call
          </button>
        </div>

        <div className="header-center">
          <div className="recording-status">
            <span className="recording-dot"></span>
            <span className="recording-text">Recording...</span>
          </div>
          <div className="volume-control">
            <span className="material-icons-outlined">volume_down</span>
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              className="volume-slider"
            />
            <span className="material-icons-outlined">volume_up</span>
          </div>
          <div className="call-controls">
            <button
              className={`control-btn ${isPaused ? 'active' : ''}`}
              onClick={() => setIsPaused(!isPaused)}
            >
              <span className="material-icons-outlined">{isPaused ? 'play_arrow' : 'pause'}</span>
            </button>
            <button
              className={`control-btn ${isMuted ? 'active' : ''}`}
              onClick={() => setIsMuted(!isMuted)}
            >
              <span className="material-icons-outlined">{isMuted ? 'mic' : 'mic_off'}</span>
            </button>
          </div>
          <div className="audio-visualizer">
            <span className="bar" style={{ height: '8px' }}></span>
            <span className="bar active" style={{ height: '20px' }}></span>
            <span className="bar" style={{ height: '12px' }}></span>
            <span className="bar active" style={{ height: '24px' }}></span>
            <span className="bar" style={{ height: '8px' }}></span>
            <span className="bar active" style={{ height: '16px' }}></span>
          </div>
        </div>

        <div className="header-right">
          <button
            className={`header-btn ${view === 'history' ? 'active' : ''}`}
            onClick={() => setView(view === 'history' ? 'main' : 'history')}
          >
            <span className="material-icons-outlined">history</span>
            히스토리 ({reports.length})
          </button>
        </div>
      </header>

      <main className="agent-main">
        {view === 'main' && (
          <div className="three-panel-layout">
            {/* Left Panel: Customer Info + Conversation */}
            <aside className="left-panel">
              {/* Customer Info Card */}
              <div className="info-card customer-info-card">
                <div className="card-header">
                  <h2>고객 정보</h2>
                  <button className="history-link">
                    <span className="material-icons-outlined">history</span>
                    <span>상담 이력</span>
                  </button>
                </div>
                <div className="info-grid">
                  {customerInfo ? (
                    <>
                      <div className="info-row">
                        <span className="info-label">고객명:</span>
                        <span className="info-value">{customerInfo.name} ({customerInfo.age || '?'}세)</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">전화번호:</span>
                        <span className="info-value">{customerInfo.phone}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">현재 요금제:</span>
                        <span className="info-value plan-value">{customerInfo.plan}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">데이터 사용:</span>
                        <span className="info-value" style={{ fontSize: '0.85em', color: '#aaa' }}>
                          전월: {customerInfo.usage?.prev || '-'}, 현월: {customerInfo.usage?.curr || '-'}
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="no-customer-info" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
                      <p>통화 대기 중...</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Conversation History */}
              <div className="info-card conversation-card">
                <div className="card-header">
                  <h2>대화 이력</h2>
                  <div className="card-actions">
                    {messages.length > 0 && (
                      <>
                        <button onClick={exportMessages} className="icon-btn" title="내보내기">
                          <span className="material-icons-outlined">save</span>
                        </button>
                        <button onClick={clearCurrentConversation} className="icon-btn" title="초기화">
                          <span className="material-icons-outlined">refresh</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {messages.length === 0 ? (
                  <div className="empty-conversation">
                    <span className="material-icons-outlined empty-icon">chat_bubble_outline</span>
                    <p>상담 대화가 표시됩니다</p>
                    <div className="empty-actions">
                      <button onClick={showSampleList} className="action-btn primary">
                        <span className="material-icons-outlined">description</span>
                        샘플 대화 불러오기
                      </button>
                      <label className="action-btn secondary">
                        <span className="material-icons-outlined">folder_open</span>
                        파일에서 불러오기
                        <input type="file" accept=".txt,.json" onChange={handleFileUpload} hidden />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="chat-messages">
                    {messages.map((msg, idx) => (
                      <div key={idx} className={`chat-bubble ${msg.role}`}>
                        <div className="bubble-avatar">
                          <span className="material-icons-outlined">
                            {msg.role === 'user' ? 'person' : 'support_agent'}
                          </span>
                        </div>
                        <div className="bubble-content">
                          <span className="bubble-author">
                            {msg.role === 'user' ? '고객' : '상담사 (AI)'}
                          </span>
                          <div
                            className="bubble-text"
                            dangerouslySetInnerHTML={{
                              __html: msg.role === 'user'
                                ? highlightKeywords(msg.content)
                                : msg.content
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>

            {/* Center Panel: AI Recommended Scripts */}
            <section className="center-panel">
              <RAGAssistant messages={messages} />
            </section>

            {/* Right Panel: Customer Intent + Recommendations */}
            <aside className="right-panel">
              {/* Tab Buttons */}
              <div className="panel-tabs">
                <button
                  className={`tab-btn ${rightPanelTab === 'intent' ? 'active' : ''}`}
                  onClick={() => setRightPanelTab('intent')}
                >
                  고객 분석
                </button>
                <button
                  className={`tab-btn ${rightPanelTab === 'report' ? 'active' : ''}`}
                  onClick={() => setRightPanelTab('report')}
                >
                  상담 보고서
                </button>
              </div>

              {rightPanelTab === 'intent' && (
                <>
                  {/* Customer Intent Card */}
                  <div className="info-card intent-card">
                    <h2>고객 의중 판단 AI</h2>
                    <div className="intent-content">
                      <p>
                        <span className="intent-highlight">{customerIntent}</span>
                      </p>

                      {/* AI Thinking Process */}
                      {(isAnalyzingIntent || aiReasoning.length > 0) && (
                        <div className="intent-reasoning">
                          <div className="reasoning-label">
                            <span className="material-icons-outlined">psychology</span>
                            <span>AI 사고 과정</span>
                          </div>
                          <div className="reasoning-steps">
                            {aiReasoning.map((step, idx) => (
                              <span key={idx} className="reasoning-step">{step}</span>
                            ))}
                            {isAnalyzingIntent && (
                              <span className="reasoning-step">...</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="intent-arrow"></div>
                  </div>

                  {/* Recommended Plans */}
                  <div className="info-card plans-card">
                    <h2>추천 요금제</h2>
                    <p className="plans-subtitle">고객에게 제안할 요금제:</p>
                    <div className="plans-list">
                      {recommendedPlans.length === 0 ? (
                        <div className="empty-plans">
                          <p>추천할 만한 요금제가 없습니다.</p>
                        </div>
                      ) : (
                        recommendedPlans.map(plan => (
                          <div
                            key={plan.id}
                            className={`plan-item ${plan.selected ? 'selected' : ''}`}
                            onClick={() => handlePlanSelect(plan.id)}
                          >
                            <h4 className={plan.selected ? 'plan-name-selected' : ''}>{plan.name}</h4>
                            <p className="plan-detail">월 {plan.price}원, {plan.data}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Plan Script Box */}
                    <div className="plan-script-box">
                      <div className="script-box-header">
                        <span className="material-icons-outlined">edit_note</span>
                        <span>추천 스크립트</span>
                      </div>
                      {scriptLoading ? (
                        <div className="script-loading">
                          <div className="script-loader"></div>
                          <span>스크립트 생성 중...</span>
                        </div>
                      ) : planScript ? (
                        <div className="script-content-box">
                          <p>{planScript}</p>
                        </div>
                      ) : (
                        <div className="script-placeholder">
                          <p>요금제를 선택하면 현재 대화 맥락에 맞는<br />추천 스크립트가 생성됩니다.</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              {rightPanelTab === 'report' && (
                <div className="report-panel-content">
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

                        <div className="progress-steps-compact">
                          {['준비', '분석', '생성', '저장', '완료'].map((label, idx) => (
                            <div
                              key={idx}
                              className={`step-compact ${processingStep >= idx + 1 ? 'active' : ''} ${processingStep > idx + 1 ? 'completed' : ''}`}
                            >
                              <div className="step-dot"></div>
                              <span>{label}</span>
                            </div>
                          ))}
                        </div>

                        <div className="progress-status">
                          <div className="status-message">{processingMessage}</div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!processing && !currentReport && (
                    <div className="empty-report">
                      <span className="material-icons-outlined empty-icon">description</span>
                      <p>보고서가 아직 생성되지 않았습니다.</p>
                      <p className="empty-help">
                        상담이 종료되면<br />
                        "보고서 생성" 버튼을 클릭하세요.
                      </p>
                      {messages.length > 0 && (
                        <button onClick={handleProcess} className="generate-report-btn">
                          <span className="material-icons-outlined">summarize</span>
                          보고서 생성
                        </button>
                      )}
                    </div>
                  )}

                  {!processing && currentReport && (
                    <div className="report-content">
                      <div className="summary-section">
                        <h3>📋 요약</h3>
                        <p>{currentReport.analysis?.summary}</p>
                      </div>

                      <div className="topics-section">
                        <h4>주요 주제</h4>
                        <div className="topic-tags">
                          {currentReport.analysis?.main_topics?.map((topic, i) => (
                            <span key={i} className="topic-tag">{topic}</span>
                          ))}
                        </div>
                      </div>

                      <div className="stats-section">
                        <div className="stat-item">
                          <span className="stat-number">{currentReport.analysis?.statistics?.total_messages}</span>
                          <span className="stat-label">전체</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-number">{currentReport.analysis?.statistics?.user_messages}</span>
                          <span className="stat-label">고객</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-number">{currentReport.analysis?.statistics?.assistant_messages}</span>
                          <span className="stat-label">상담사</span>
                        </div>
                      </div>

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
              )}
            </aside>
          </div>
        )}

        {view === 'history' && (
          <div className="history-view">
            <div className="history-header">
              <h2>📚 보고서 히스토리</h2>
              <button onClick={() => setView('main')} className="back-btn">
                <span className="material-icons-outlined">arrow_back</span>
                돌아가기
              </button>
            </div>

            {reports.length === 0 ? (
              <div className="empty-state">
                <span className="material-icons-outlined empty-icon">folder_open</span>
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
                          onClick={(e) => deleteReport(report.id, e)}
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
              <button onClick={() => setView('main')} className="back-btn">
                <span className="material-icons-outlined">arrow_back</span>
                돌아가기
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
                  <span className="material-icons-outlined sample-arrow">arrow_forward</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
