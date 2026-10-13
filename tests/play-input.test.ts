import { describe, expect, it } from 'vitest';
import { actionInputProblems } from '../apps/web/src/play-input.js';
import type { Parameter } from '@ai-engine/contracts';

const parameters: Record<string, Parameter> = { amount: { type: 'integer', min: 0, max: 30 }, confirm: { type: 'boolean' }, note: { type: 'string' }, destination: { type: 'entity_ref', allowed_entity_ids: ['room'] } };
describe('玩家行动参数', () => {
  it('明确的零、否和空文本都有效，未填写不得冒充这些值', () => {
    expect(actionInputProblems(parameters, { amount: 0, confirm: false, note: '', destination: 'room' })).toEqual({});
    expect(Object.keys(actionInputProblems(parameters, {}))).toEqual(['amount', 'confirm', 'note', 'destination']);
  });
  it.each([0.5, 31, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('非法数值 %s 不舍入或裁剪为合法行动', amount => {
    expect(actionInputProblems({ amount: parameters.amount! }, { amount }).amount).toBeTruthy();
  });
  it('类型错误及不在候选范围的引用不能提交', () => {
    expect(Object.keys(actionInputProblems(parameters, { amount: '20', confirm: 'false', note: true, destination: 'hidden-room' }))).toEqual(['amount', 'confirm', 'note', 'destination']);
  });
});
