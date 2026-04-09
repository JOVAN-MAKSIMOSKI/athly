import type {
  CreateMessageRequest,
  ElicitRequest,
  ElicitResult,
} from '@modelcontextprotocol/sdk/types.js'

export type SamplingRequestState = {
  request: CreateMessageRequest
  resolve: (approved: boolean) => void
}

export type ElicitationRequestState = {
  request: ElicitRequest
  resolve: (result: ElicitResult) => void
}

export type ElicitationContent = Record<string, string | number | boolean | string[]>