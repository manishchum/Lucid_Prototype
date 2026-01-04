(async () => {
  try {
    const body = { query: 'what is critical problem solving', mode: 'doubt', user_id: 'test-uid' }
    const res = await fetch('http://localhost:3001/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    // console.log('STATUS', res.status)
    // console.log('BODY', text)
  } catch (e) {
    console.error('ERROR', e)
    process.exit(1)
  }
})()
