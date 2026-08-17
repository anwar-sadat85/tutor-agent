import { BedrockModel } from '@strands-agents/sdk/models/bedrock';

export function loadModel(): BedrockModel {
  return new BedrockModel({
    modelId: 'us.anthropic.claude-sonnet-4-6',
    region: 'us-west-2',
  });
}