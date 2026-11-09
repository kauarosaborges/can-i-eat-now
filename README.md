# Can I Eat Now?

App de jejum intermitente e hidratação. Roda como PWA no navegador e como app nativo de iPhone (Capacitor), com notificações locais que chegam mesmo com o app fechado e sem internet. Os dados ficam só no aparelho.

## Estrutura

- `www/`: o app web (HTML, CSS e módulos ES puros, sem bundler). É o que vai para o GitHub Pages e para dentro do app iOS.
- `www/src/core/`: regras puras e testáveis (jejum, refeições, água, histórico, plano de notificações, armazenamento).
- `ios/`: projeto Xcode gerado pelo Capacitor 8 (Swift Package Manager, sem CocoaPods).
- `tests/`: testes com `node:test`.
- `scripts/generate-icons.mjs`: gera os ícones PNG do PWA, o ícone 1024 do iOS e a tela de abertura, só com módulos nativos do Node.
- `.github/workflows/`: deploy do Pages e build para o TestFlight.

## Rodar localmente

```sh
npm ci
npm test
python -m http.server 8080 --directory www
```

Depois abra `http://localhost:8080`. Sem Python, qualquer servidor estático apontado para `www/` serve.

## Instalar como PWA no iPhone

1. Abra `https://kauarosaborges.github.io/can-i-eat-now/` no Safari.
2. Toque em Compartilhar e depois em Adicionar à Tela de Início.

No PWA, os lembretes do sistema só aparecem com o app aberto ou recém aberto. Para avisos com o app fechado, use o app nativo pelo TestFlight.

## App nativo e notificações

No app nativo, o plano de notificações (`www/src/core/notificationPlan.js`) agenda até 60 avisos locais (os mais próximos) para as próximas 96 horas:

- lembretes de água, com o botão "Bebi" que registra o copo direto da notificação;
- refeição liberada, no horário de cada refeição permitida;
- fim do jejum, quando a janela abre (adiado para a hora de acordar se cair durante o sono);
- janela fechando, 30 minutos antes do fim.

Cada tipo pode ser desligado em Ajustes, Lembretes. O plano é refeito a cada mudança, ao abrir o app e ao voltar para ele. Com o app aberto, o lembrete de água aparece como aviso do sistema e também na tela, e registrar por um dos dois limpa o outro. Se o app ficar mais de quatro dias sem ser aberto (ou os 60 avisos acabarem antes), os avisos param até a próxima abertura.

## Pipeline

- Push na `main` roda os testes e publica `www/` no GitHub Pages (`pages.yml`).
- Push na `main` que mexe em `www/`, `ios/`, `package.json`, `package-lock.json` ou `capacitor.config.json` gera o build iOS e envia para o TestFlight (`ios-testflight.yml`). Também dá para rodar na mão em Actions, iOS build to TestFlight, Run workflow.
- O número do build é o número da execução do workflow. A versão exibida vem de `MARKETING_VERSION` no projeto Xcode (hoje 1.0).
- O build do iOS roda em `macos-26` com o Xcode 26 mais novo instalado no runner, e mostra a versão no log.
- Os dois workflows instalam com `npm ci --ignore-scripts` e conferem as assinaturas dos pacotes com `npm audit signatures`.
- Sem os segredos configurados, o workflow do iOS termina verde com um aviso, sem tentar assinar.

## Configuração única (Apple e GitHub)

### App Store Connect e Apple Developer

1. Em Certificates, Identifiers & Profiles, Identifiers, registre o App ID explícito `com.staackyz.canieatnow` (sem capabilities extras: notificação local não precisa de Push Notifications).
2. Em App Store Connect, Apps, crie o app: plataforma iOS, nome "Can I Eat Now?" (ou outro disponível), idioma principal Português (Brasil), bundle ID `com.staackyz.canieatnow`, SKU qualquer, por exemplo `can-i-eat-now`.
3. Em Users and Access, Integrations, App Store Connect API, Team Keys, gere uma chave com a função App Manager e marque Access to Certificates, Identifiers & Profiles. Ela precisa criar o certificado de distribuição e o perfil automaticamente. Baixe o arquivo `.p8` (só dá para baixar uma vez) e anote o Key ID e o Issuer ID. Só troque para uma chave Admin se o build falhar com erro de permissão na assinatura.
4. Anote o Team ID em developer.apple.com, Membership details.
5. Em TestFlight, crie um grupo de teste interno e adicione você. Depois do primeiro upload, cada build novo aparece ali sozinho.

### GitHub

1. Em Settings, Pages, Build and deployment, troque Source para GitHub Actions.
2. Em Settings, Environments, crie o ambiente `testflight`. Em Deployment branches and tags, escolha Selected branches and tags e adicione só a `main`.
3. Dentro desse ambiente (não nos segredos do repositório), crie os segredos:
   - `APPLE_TEAM_ID`: o Team ID;
   - `ASC_KEY_ID`: o Key ID da chave;
   - `ASC_ISSUER_ID`: o Issuer ID;
   - `ASC_PRIVATE_KEY`: o conteúdo inteiro do arquivo `.p8`, incluindo as linhas BEGIN e END.
4. Nunca coloque o `.p8` no repositório. O `.gitignore` já bloqueia `*.p8`, `*.p12`, `*.mobileprovision` e `AuthKey_*`.

## Ícones e tela de abertura

```sh
node scripts/generate-icons.mjs
```

Gera os PNG do PWA em `www/icons/` e, se a pasta `ios/` existir, o ícone 1024 sem transparência e a tela de abertura do iOS.

## Atualizar a versão

- Web: troque `CACHE_VERSION` em `www/sw.js`. O app mostra "Nova versão disponível" e recarrega quando você toca em Atualizar.
- iOS: para uma versão nova na App Store, aumente `MARKETING_VERSION` no projeto Xcode. Builds de teste só precisam do push.

## Dados

- Tudo fica no `localStorage` do aparelho, na chave `canIEatNow.state`.
- Se os dados salvos estiverem corrompidos ou forem de outra versão, o app guarda uma cópia em `canIEatNow.backup.<data>` antes de começar do zero, e avisa.
- Com duas abas abertas, uma acompanha as mudanças da outra.
