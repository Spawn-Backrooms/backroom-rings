import { fauxAssistantMessage, fauxProvider, fauxToolCall, type FauxResponseFactory, type TranscriptContext } from '@earendil-works/pi-ai';
import { assertInteger, record } from '../client/codec.js';

function currentDelivery(context: TranscriptContext): { episodeId: string; task: number[] } {
  const message = context.messages.findLast(item => item.role === 'user');
  if (!message) throw new Error('fixture_delivery_missing');
  const text = typeof message.content === 'string' ? message.content : message.content.filter(item => item.type === 'text').map(item => item.text).join('');
  const delivery = record(JSON.parse(text));
  if (typeof delivery.episodeId !== 'string' || !Array.isArray(delivery.task)) throw new Error('fixture_delivery_invalid');
  for (const item of delivery.task) assertInteger(item, 0, 100);
  return { episodeId: delivery.episodeId, task: delivery.task as number[] };
}

export function deterministicInferenceFixture() {
  const fixture = fauxProvider({ provider: 'backrooms-fixture', models: [{ id: 'investigator-v0' }, { id: 'critic-v0' }], tokensPerSecond: 0 });
  const answer: FauxResponseFactory = (context, _options, _state, model) => {
    const delivery = currentDelivery(context);
    const lastUser = context.messages.findLastIndex(item => item.role === 'user');
    const recent = context.messages.slice(lastUser + 1);
    const tool = recent.findLast(item => item.role === 'toolResult');
    const toolName = model.id === 'investigator-v0' ? 'read_private_memory' : 'read_private_candidate';
    if (!tool) return fauxAssistantMessage(fauxToolCall(toolName, { episodeId: delivery.episodeId }));
    if (tool.role !== 'toolResult' || tool.isError) throw new Error('fixture_private_tool_failed');
    const content = tool.content.filter(item => item.type === 'text').map(item => item.text).join('');
    const data = record(JSON.parse(content));
    if (model.id === 'investigator-v0') {
      if (!Array.isArray(data.scores) || data.scores.length !== 2) throw new Error('fixture_policy_missing');
      assertInteger(data.scores[0], 0, 100);
      assertInteger(data.scores[1], 0, 100);
      const selectedProcedure = data.scores[0] >= data.scores[1] ? 0 : 1;
      const ordered = [...delivery.task].sort((a, b) => a - b);
      const value = selectedProcedure === 0 ? delivery.task[0] : ordered[Math.floor(ordered.length / 2)];
      return fauxAssistantMessage(JSON.stringify({ selectedProcedure, procedure: selectedProcedure === 0 ? 'take-first' : 'sort-and-take-median', value, memoryRevision: data.revision, lessonUsed: data.lesson }));
    }
    assertInteger(data.selectedProcedure, 0, 1);
    return fauxAssistantMessage(JSON.stringify({ lesson: 'Sort inputs before selecting the median.', selectedProcedure: data.selectedProcedure, feedback: { negative: data.selectedProcedure === 0, magnitude: 10 } }));
  };
  fixture.setResponses(Array.from({ length: 32 }, () => answer));
  return fixture;
}
