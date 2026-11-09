# Can I Eat Now?

PWA de jejum intermitente e hidratação. HTML, CSS e JavaScript puros, sem dependências e sem build. Os dados ficam só no aparelho (localStorage).

## Rodar localmente

Qualquer servidor estático serve. Service worker exige `http://localhost` ou HTTPS.

```sh
python -m http.server 8080
```

Depois abra `http://localhost:8080`.

Sem Python, com Node:

```sh
node -e "const h=require('http'),f=require('fs'),p=require('path'),t={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};h.createServer((q,r)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';const x=p.join(process.cwd(),p.normalize(u));if(!x.startsWith(process.cwd()))return r.writeHead(403).end();f.readFile(x,(e,d)=>e?r.writeHead(404).end():r.writeHead(200,{'Content-Type':t[p.extname(x)]||'application/octet-stream'}).end(d))}).listen(8080)"
```

Funciona em subpasta (GitHub Pages, por exemplo), porque todos os caminhos são relativos.

## Testes

```sh
npm test
```

Usa só o `node:test` nativo (Node 20 ou mais novo).

## Ícones

Os PNG em `icons/` são gerados por `node scripts/generate-icons.mjs`, que usa só módulos nativos do Node.

## Instalar no iPhone

1. Abra o endereço no Safari.
2. Toque em Compartilhar.
3. Toque em Adicionar à Tela de Início.

No computador, Chrome e Edge mostram o botão de instalar na barra de endereço.

## Lembretes de água

- Com o app aberto, o lembrete aparece na tela (copo enchendo) mesmo sem permissão.
- Notificação do sistema só aparece depois que você permite, e o pedido só acontece quando você toca no botão.
- No iPhone, notificação só funciona com o app instalado na Tela de Início (iOS 16.4 ou mais novo).
- Não existe servidor de push. Com o app fechado ou em segundo plano por muito tempo, o sistema pausa o app e os lembretes param até você abrir de novo.

## Atualizar a versão

Ao publicar mudança, troque `CACHE_VERSION` em `sw.js`. O app mostra o aviso "Nova versão disponível" e só recarrega quando você toca em Atualizar, assim todos os arquivos vêm da mesma versão.

## Dados

- Tudo fica no `localStorage` do aparelho, na chave `canIEatNow.state`.
- Se os dados salvos estiverem corrompidos ou forem de outra versão, o app guarda uma cópia em `canIEatNow.backup.<data>` antes de começar do zero, e avisa.
- Com duas abas abertas, uma acompanha as mudanças da outra.
