import { useState, useCallback } from 'react';
import { Document, Message, Citation, RAGConfig, DEFAULT_CONFIG } from '@/types/rag';

const API_BASE = 'http://localhost:8000';

export function useRAG() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [config, setConfig] = useState<RAGConfig>(DEFAULT_CONFIG);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);

  const uploadDocument = useCallback(async (file: File) => {
    const tempId = crypto.randomUUID();
    const docType = getDocType(file.name);
    
    const newDoc: Document = {
      id: tempId,
      name: file.name,
      type: docType,
      size: file.size,
      status: 'uploading',
      uploadedAt: new Date(),
    };
    
    setDocuments(prev => [...prev, newDoc]);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('chunk_size', config.chunkSize.toString());
      formData.append('chunk_overlap', config.chunkOverlap.toString());
      
      // Update status to processing
      setDocuments(prev => 
        prev.map(d => d.id === tempId ? { ...d, status: 'processing' } : d)
      );
      
      const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Upload failed');
      
      const result = await response.json();
      
      setDocuments(prev =>
        prev.map(d => d.id === tempId ? {
          ...d,
          id: result.document_id,
          status: 'indexed',
          chunks: result.chunks_count,
        } : d)
      );
    } catch (error) {
      setDocuments(prev =>
        prev.map(d => d.id === tempId ? {
          ...d,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        } : d)
      );
    }
  }, [config]);

  const deleteDocument = useCallback(async (id: string) => {
    try {
      await fetch(`${API_BASE}/documents/${id}`, { method: 'DELETE' });
      setDocuments(prev => prev.filter(d => d.id !== id));
    } catch (error) {
      console.error('Delete failed:', error);
    }
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    
    setMessages(prev => [...prev, userMessage]);
    setIsProcessing(true);
    
    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
    };
    
    setMessages(prev => [...prev, assistantMessage]);
    
    try {
      const response = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: content,
          top_k: config.topK,
          similarity_threshold: config.similarityThreshold,
          model: config.model,
        }),
      });
      
      if (!response.ok) throw new Error('Query failed');
      
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let citations: Citation[] = [];
      
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6));
              
              if (data.type === 'token') {
                fullContent += data.content;
                setMessages(prev =>
                  prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m)
                );
              } else if (data.type === 'citations') {
                citations = data.citations;
              }
            }
          }
        }
      }
      
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? {
          ...m,
          content: fullContent,
          citations,
          isStreaming: false,
        } : m)
      );
    } catch (error) {
      setMessages(prev =>
        prev.map(m => m.id === assistantId ? {
          ...m,
          content: 'Error: Failed to get response. Make sure the FastAPI backend is running.',
          isStreaming: false,
        } : m)
      );
    } finally {
      setIsProcessing(false);
    }
  }, [config]);

  const clearChat = useCallback(() => {
    setMessages([]);
    setSelectedCitation(null);
  }, []);

  return {
    documents,
    messages,
    isProcessing,
    config,
    selectedCitation,
    setConfig,
    uploadDocument,
    deleteDocument,
    sendMessage,
    clearChat,
    setSelectedCitation,
  };
}

function getDocType(filename: string): Document['type'] {
  const ext = filename.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'pdf': return 'pdf';
    case 'docx': case 'doc': return 'docx';
    case 'txt': case 'md': return 'txt';
    default: return 'image';
  }
}
