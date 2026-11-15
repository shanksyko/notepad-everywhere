# Notepad Everywhere

Bloco de notas em árvore para estudar, com glossário vivo, repetição espaçada e foco. Funciona offline; os dados ficam no seu computador.

## O que ele faz

- **Notas em árvore**: cadernos, seções, páginas e subpáginas, com ícones, tags e arrastar-e-soltar.
- **Glossário vivo**: selecione uma palavra, dê um significado e ela passa a abrir um pop-up em qualquer nota. Pop-ups abrem em cascata (um conceito dentro do outro) e podem ser fixados, arrastados e editados.
- **Lacunas (cloze) e repetição espaçada**: esconda trechos para se testar; o app agenda as revisões e mostra o domínio de cada página (vermelho, amarelo, verde).
- **Editor rico**: títulos, listas, checklists, tabelas, callouts, fórmulas LaTeX, blocos de código executáveis (JavaScript e Python), fonte e tamanho do texto.
- **Canvas livre**: caixas de texto, desenho à mão, setas e mídias — como página inteira ou embutido no meio de uma nota.
- **Qualquer arquivo na nota**: imagens com pins interativos, áudio e vídeo com loop A–B e marcação de timestamp, PDF com "Extrair para Nota", e cartões para os demais arquivos.
- **Pomodoro e sons de foco** (ruído marrom, chuva, binaural 40 Hz), Modo Zen, Spotlight e régua de leitura.
- **Backup automático** em uma pasta do OneDrive, Google Drive, Documentos ou qualquer outra; restaurar e mesclar entre dois PCs.
- **Lixeira** (30 dias) e **histórico de versões** por página.
- **Imprimir / salvar em PDF** uma página ou o caderno inteiro.
- **Notificações**: lembretes próprios, perguntas de revisão e avisos do Pomodoro; opcionalmente em segundo plano, na bandeja do sistema.
- 11 temas, atalhos de teclado configuráveis e um botão para cada função.

## Instalar

Baixe o instalador `Notepad Everywhere Setup x.y.z.exe` na página de Releases e execute. Ele instala só para o seu usuário, sem pedir administrador.

O instalador não é assinado: na primeira execução o Windows SmartScreen mostra um aviso. Clique em **Mais informações → Executar assim mesmo**.

## Onde ficam os dados

Em `%APPDATA%\notepad-everywhere`. Atualizar ou reinstalar o app não apaga as notas. Para levar para outro PC, use **Backup → Exportar .zip** e depois **Importar .zip** (substitui tudo) ou **Mesclar .zip** (junta com o que já existe).

## Desenvolvimento

Requer [Node.js](https://nodejs.org) 20 ou mais recente.

```bash
npm install
```

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Abre o app no navegador, com recarga automática (sem os recursos nativos: backup em pasta, bandeja, salvar PDF). |
| `npm run typecheck` | Verifica os tipos TypeScript. |
| `npm run dist` | Compila e gera o instalador em `release/`. |
| `npm test` | Roda a suíte de testes de ponta a ponta contra o app empacotado em `release/win-unpacked` (rode `npm run dist` antes). |

### Estrutura

- `src/` — aplicação (React + TypeScript + Tailwind, editor TipTap, banco IndexedDB via Dexie).
- `electron/` — processo principal: janela, backup em pasta, bandeja, PDF e atualização.
- `tests/e2e.mjs` — testes de ponta a ponta (dirigem o app real pelo protocolo de depuração do Chromium).
- `build/` — ícone do aplicativo.

### Atualização automática

O app usa `electron-updater` com as Releases deste repositório (configurado em `package.json`, em `build.publish`).

Para publicar uma versão:

1. Aumente `"version"` em `package.json`.
2. Rode `npm run dist`.
3. Crie uma Release no GitHub com a tag `v` + versão (por exemplo `v0.2.0`) e anexe os três arquivos gerados em `release/`: o `.exe`, o `.exe.blockmap` e o `latest.yml`.

Os apps já instalados encontram a versão nova sozinhos e oferecem "Reiniciar e atualizar".

## Licença

[MIT](LICENSE)
