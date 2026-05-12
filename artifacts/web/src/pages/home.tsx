import React, { useState, useRef, useEffect } from "react";
import { 
  useListDocuments, 
  getListDocumentsQueryKey, 
  useUploadDocument, 
  useQueryDocuments 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, FileText, Search, Loader2, Database, AlertCircle, TerminalSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export default function Home() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Data hooks
  const { data: documentList, isLoading: isDocumentsLoading, error: documentsError } = useListDocuments();
  const uploadMutation = useUploadDocument();
  const queryMutation = useQueryDocuments();

  // Local state
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [messages, setMessages] = useState<Array<{
    role: "user" | "assistant";
    content: string;
    sources?: { blobId: string; source?: string; score: number }[];
  }>>([]);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    toast({
      title: "Uploading document...",
      description: `Processing ${file.name}`,
    });

    uploadMutation.mutate(
      { data: { file } },
      {
        onSuccess: (result) => {
          toast({
            title: "Upload complete",
            description: `Stored ${result.chunksStored} chunks from ${result.filename}`,
          });
          queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
          if (fileInputRef.current) fileInputRef.current.value = "";
        },
        onError: (err: any) => {
          toast({
            title: "Upload failed",
            description: err.message || "An error occurred",
            variant: "destructive",
          });
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      }
    );
  };

  const handleQuery = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || queryMutation.isPending) return;

    const userQuery = query.trim();
    setMessages(prev => [...prev, { role: "user", content: userQuery }]);
    setQuery("");

    queryMutation.mutate(
      { data: { query: userQuery, topK: 5 } },
      {
        onSuccess: (result) => {
          setMessages(prev => [
            ...prev, 
            { 
              role: "assistant", 
              content: result.answer,
              sources: result.sources
            }
          ]);
        },
        onError: (err: any) => {
          toast({
            title: "Query failed",
            description: err.message || "Could not fetch answer",
            variant: "destructive",
          });
          setMessages(prev => prev.slice(0, -1)); // Revert user message on error
          setQuery(userQuery); // Restore query text
        }
      }
    );
  };

  const hasDocuments = documentList && documentList.count > 0;

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/30 text-foreground font-mono">
      {/* Sidebar: Document Management */}
      <div className="w-80 flex-shrink-0 border-r border-border/50 bg-card/30 flex flex-col backdrop-blur-xl">
        <div className="p-6 border-b border-border/50">
          <div className="flex items-center gap-2 mb-6 text-primary">
            <TerminalSquare className="w-5 h-5" />
            <h1 className="font-bold tracking-tight text-lg uppercase">SHELBY.RAG</h1>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Upload text documents to populate the knowledge base.
          </p>
          <div className="relative">
            <input 
              type="file" 
              ref={fileInputRef}
              onChange={handleUpload}
              className="hidden" 
              accept=".txt,.md,.mdx,.csv,.json,.yaml,.yml,.xml,.html,.pdf,.docx,.doc" 
              data-testid="input-file-upload"
            />
            <Button 
              onClick={() => fileInputRef.current?.click()} 
              disabled={uploadMutation.isPending}
              className="w-full justify-start text-xs font-mono bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground border border-primary/20 transition-all"
              data-testid="button-upload-doc"
            >
              {uploadMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              {uploadMutation.isPending ? "INGESTING..." : "UPLOAD DOCUMENT"}
            </Button>
          </div>
        </div>

        <div className="p-4 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3 px-2">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center">
              <Database className="w-3 h-3 mr-2" />
              Indexed Chunks
            </h2>
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/20 text-primary/80">
              {documentList?.count || 0}
            </Badge>
          </div>
          
          <ScrollArea className="flex-1 -mx-2 px-2">
            {isDocumentsLoading ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mb-2 opacity-50" />
                <span className="text-xs">Loading index...</span>
              </div>
            ) : documentsError ? (
              <div className="p-4 text-xs text-destructive bg-destructive/10 rounded-md border border-destructive/20 flex items-start">
                <AlertCircle className="w-4 h-4 mr-2 shrink-0 mt-0.5" />
                Failed to load documents.
              </div>
            ) : !hasDocuments ? (
              <div className="text-center p-6 border border-dashed border-border/50 rounded-md text-muted-foreground bg-muted/20">
                <FileText className="w-6 h-6 mx-auto mb-2 opacity-20" />
                <p className="text-xs">No documents indexed. Upload a file to begin.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {documentList.documents.slice(0, 100).map((doc, i) => (
                  <div key={doc.blobId + i} className="group p-3 rounded-md border border-border/40 bg-card/40 hover:border-primary/30 hover:bg-primary/5 transition-colors cursor-default" data-testid={`card-chunk-${doc.blobId}`}>
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="text-[10px] text-muted-foreground font-semibold truncate max-w-[150px]" title={doc.source}>
                        {doc.source}
                      </span>
                      <span className="text-[9px] text-primary/60 bg-primary/10 px-1 rounded">
                        #{doc.index}
                      </span>
                    </div>
                    <p className="text-xs text-foreground/80 line-clamp-3 leading-relaxed">
                      {doc.preview}
                    </p>
                  </div>
                ))}
                {documentList.count > 100 && (
                  <div className="text-center text-xs text-muted-foreground py-2 italic">
                    + {documentList.count - 100} more chunks
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* Main Area: Query Workspace */}
      <div className="flex-1 flex flex-col relative bg-background bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-background">
        <div className="flex-1 flex flex-col min-h-0 max-w-4xl mx-auto w-full px-6">
          
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center max-w-md mx-auto w-full opacity-60">
              <div className="w-16 h-16 rounded-2xl bg-card border border-primary/20 flex items-center justify-center mb-6 shadow-[0_0_30px_hsl(var(--primary)/0.1)]">
                <Search className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-xl font-medium text-foreground mb-2">Interrogate your documents</h2>
              <p className="text-sm text-muted-foreground text-center">
                Ask specific questions. The system will retrieve relevant chunks and generate a grounded answer.
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1 py-6 pr-4">
              <div className="space-y-8 pb-8">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                    <div className="flex items-center gap-2 mb-1.5 px-1">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
                        {msg.role === "user" ? "USER" : "SYSTEM"}
                      </span>
                    </div>
                    
                    {msg.role === "user" ? (
                      <div className="max-w-[80%] bg-card border border-border/50 rounded-lg p-4 text-sm text-foreground shadow-sm">
                        {msg.content}
                      </div>
                    ) : (
                      <div className="max-w-full space-y-4">
                        <div className="bg-primary/5 border border-primary/20 rounded-lg p-5 text-sm text-foreground leading-relaxed shadow-sm">
                          {msg.content}
                        </div>
                        
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="pl-2 border-l-2 border-primary/20">
                            <h4 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Sources</h4>
                            <div className="flex flex-wrap gap-2">
                              {msg.sources.map((src, i) => (
                                <div key={i} className="flex items-center gap-1.5 bg-card/50 border border-border rounded px-2 py-1 text-xs">
                                  <FileText className="w-3 h-3 text-primary/70" />
                                  <span className="text-muted-foreground truncate max-w-[150px]" title={src.source || src.blobId}>
                                    {src.source || src.blobId.slice(0,8)}
                                  </span>
                                  <span className="text-[10px] text-primary/60 font-mono ml-1">
                                    {(src.score * 100).toFixed(0)}%
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                
                {queryMutation.isPending && (
                  <div className="flex flex-col items-start animate-pulse">
                    <div className="flex items-center gap-2 mb-1.5 px-1">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">SYSTEM</span>
                    </div>
                    <div className="bg-primary/5 border border-primary/20 rounded-lg p-5 w-64 h-20 shadow-sm flex items-center justify-center">
                      <Loader2 className="w-5 h-5 text-primary animate-spin" />
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}

          {/* Input Area */}
          <div className="pt-4 pb-8 mt-auto shrink-0 relative">
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background to-transparent -top-10 pointer-events-none" />
            <form onSubmit={handleQuery} className="relative z-10">
              <div className="relative flex items-center shadow-lg shadow-black/5">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-primary/50">
                  <TerminalSquare className="w-5 h-5" />
                </div>
                <Input 
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={hasDocuments ? "Ask a question about your documents..." : "Upload documents to ask questions..."}
                  disabled={!hasDocuments || queryMutation.isPending}
                  className="pl-12 pr-12 py-6 text-sm bg-card border-primary/20 focus-visible:ring-primary/30 rounded-xl font-sans"
                  data-testid="input-query"
                />
                <Button 
                  type="submit" 
                  size="icon"
                  disabled={!query.trim() || !hasDocuments || queryMutation.isPending}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 rounded-lg"
                  data-testid="button-submit-query"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
              {!hasDocuments && (
                <p className="text-center text-xs text-destructive mt-3 flex items-center justify-center gap-1.5">
                  <AlertCircle className="w-3 h-3" />
                  Index is empty. Upload documents first.
                </p>
              )}
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
