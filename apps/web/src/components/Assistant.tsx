import { useEffect, useRef, useState, type FormEvent } from 'react';
import { streamChat, type ChatTurn, type Citation } from '../lib/chat';
import { RichText } from './RichText';

const CLINIC_PHONE = import.meta.env.VITE_CLINIC_PHONE ?? '(81) 3333-0000';

interface Message extends ChatTurn {
  sources?: Citation[];
  emergency?: boolean;
  error?: string;
  pending?: boolean;
}

const SUGGESTIONS = [
  'Tem alguma vacina atrasada?',
  'Quando foi o último vermífugo?',
  'O que a veterinária disse na última consulta?',
  'Qual o próximo agendamento?',
];

export function Assistant({
  petId,
  petName,
  onClose,
}: {
  petId?: string;
  petName?: string;
  onClose(): void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  const update = (patch: Partial<Message>) =>
    setMessages((m) => [...m.slice(0, -1), { ...m[m.length - 1], ...patch }]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    const history: ChatTurn[] = messages
      .filter((m) => !m.error && m.content)
      .map(({ role, content }) => ({ role, content }));
    setMessages((m) => [
      ...m,
      { role: 'user', content: question },
      { role: 'assistant', content: '', pending: true },
    ]);
    setInput('');
    setBusy(true);
    abort.current = new AbortController();

    let answer = '';
    try {
      for await (const event of streamChat({ message: question, history, petId }, abort.current.signal)) {
        if (event.type === 'meta') update({ emergency: event.emergency });
        if (event.type === 'sources') update({ sources: event.sources });
        if (event.type === 'token') {
          answer += event.text;
          update({ content: answer, pending: false });
        }
        if (event.type === 'error') update({ error: event.message, pending: false });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        update({ error: 'Sem conexão com a assistente. Verifique sua internet.', pending: false });
      }
    } finally {
      update({ pending: false });
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <aside className="assistant" aria-label="Assistente Pata">
      <header className="assistant__head">
        <div>
          <h2>Pergunte à Pata</h2>
          <p>{petName ? `Respondendo sobre ${petName}` : 'Responde com o histórico dos seus pets'}</p>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar assistente">
          ✕
        </button>
      </header>

      <div className="assistant__body" aria-live="polite">
        {messages.length === 0 && (
          <div className="assistant__empty">
            <p>
              Pergunte sobre vacinas, consultas, banhos ou agendamentos. A Pata consulta o
              prontuário e mostra de onde tirou cada informação.
            </p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) =>
          m.role === 'user' ? (
            <p key={i} className="bubble bubble--user">
              {m.content}
            </p>
          ) : (
            <div key={i} className="bubble bubble--pata">
              {m.emergency && (
                <p className="emergency" role="alert">
                  Se for uma emergência, não espere: ligue para a clínica agora no {CLINIC_PHONE}
                  ou vá ao pronto-atendimento veterinário mais próximo.
                </p>
              )}
              {m.pending && <span className="typing" aria-label="Pata está digitando" />}
              {m.content && <RichText text={m.content} sources={m.sources} />}
              {m.error && <p className="bubble__error">{m.error}</p>}
              {!m.pending && m.sources && m.sources.length > 0 && m.content && (
                <details className="sources">
                  <summary>Consultou {m.sources.length} registros</summary>
                  <ol>
                    {m.sources.map((s) => (
                      <li key={s.ref}>
                        {s.title}, {s.petName}
                        {s.date ? `, ${s.date}` : ''}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <form className="assistant__form" onSubmit={submit}>
        <textarea
          ref={inputRef}
          value={input}
          rows={1}
          placeholder={petName ? `Pergunte sobre ${petName}...` : 'Escreva sua pergunta...'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
          aria-label="Sua pergunta"
          maxLength={2000}
        />
        <button className="btn btn--primary" disabled={busy || !input.trim()}>
          Enviar
        </button>
      </form>
      <p className="assistant__note">A Pata não substitui a consulta veterinária.</p>
    </aside>
  );
}
