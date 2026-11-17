import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { api, proposeConceptsStream, type ChatEvent, type ProposeConceptsPayload } from './client'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('API Client SSE Stream & Model Probe Security', () => {
  it('proposeConceptsStream preserves leading spaces, "0" tokens, and split multi-byte UTF-8 chunks', async () => {
    const encoder = new TextEncoder()
    const chinesePayload = 'event:thinking\ndata:架构师正在分析版本 \n\nevent:thinking\ndata:0\n\nevent:thinking\ndata: world — 中文跨块测试\n\n'
    const fullBytes = encoder.encode(chinesePayload)
    // 故意在多字节 UTF-8 中文字符中间切分字节流，验证 stream: true 解码器与 EOF flush
    const splitPoint = fullBytes.length - 7
    const chunk1 = fullBytes.slice(0, splitPoint)
    const chunk2 = fullBytes.slice(splitPoint)

    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk1)
          controller.enqueue(chunk2)
          controller.close()
        },
      })
      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch

    const received: Array<ChatEvent<ProposeConceptsPayload | string>> = []
    let doneCalled = false

    await proposeConceptsStream(
      { project_id: 'p1', input: 'test' },
      {
        onEvent: (ev) => received.push(ev),
        onDone: () => {
          doneCalled = true
        },
      },
    )

    assert.equal(doneCalled, true)
    assert.equal(received.length, 3)
    assert.equal(received[0].data, '架构师正在分析版本 ')
    assert.strictEqual(received[1].data, '0', '单字符 "0" token 必须保持为字符串而非假值丢失')
    assert.equal(received[2].data, ' world — 中文跨块测试', '英文词首空格与跨 chunk 中文字符必须零损还原')
  })

  it('proposeConceptsStream exits quietly without error callback when aborted via AbortController', async () => {
    const controller = new AbortController()
    let errorCalled = false
    let doneCalled = false

    globalThis.fetch = (async (_input, init) => {
      const signal = init?.signal
      const stream = new ReadableStream<Uint8Array>({
        pull() {
          controller.abort()
          const abortErr = new Error('The operation was aborted')
          abortErr.name = 'AbortError'
          if (signal?.aborted) {
            throw abortErr
          }
        },
      })
      return new Response(stream, { status: 200 })
    }) as typeof fetch

    await proposeConceptsStream(
      { project_id: 'p1', input: 'abort test' },
      {
        onEvent: () => {},
        onError: () => {
          errorCalled = true
        },
        onDone: () => {
          doneCalled = true
        },
      },
      controller.signal,
    )

    assert.equal(errorCalled, false)
    assert.equal(doneCalled, false)
  })

  it('api.getModels uses POST JSON body when api_key or base_url is provided so secrets never enter URL query', async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = []

    globalThis.fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        method: init?.method || 'GET',
        body: typeof init?.body === 'string' ? init.body : undefined,
      })
      return new Response(
        JSON.stringify({
          code: 200,
          message: 'success',
          data: { default_provider: 'openai', default_model: 'gpt-4o', models: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    await api.getModels({ provider: 'deepseek' })
    await api.getModels({
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-super-secret',
    })

    assert.equal(calls.length, 2)
    assert.equal(calls[0].method, 'GET')
    assert.ok(calls[0].url.endsWith('/models/list?provider=deepseek'))

    assert.equal(calls[1].method, 'POST')
    assert.ok(!calls[1].url.includes('sk-super-secret'), 'URL 中严禁出现明文 api_key')
    assert.ok(calls[1].body?.includes('sk-super-secret'), '敏感 api_key 应放在 JSON 请求体中传输')
  })
})
