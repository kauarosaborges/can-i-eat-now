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

1. Abra `https://staackyz.github.io/can-i-eat-now/` no Safari.
2. Toque em Compartilhar e depois em Adicionar à Tela de Início.

No PWA, os lembretes do sistema só aparecem com o app aberto ou recém aberto. Para avisos com o app fechado, use o app nativo pelo TestFlight.

## App nativo e notificações

No app nativo, o plano de notificações (`www/src/core/notificationPlan.js`) agenda até 60 avisos locais (os mais próximos) para as próximas 96 horas:

- lembretes de água, com o botão "Bebi" que registra o copo direto da notificação;
- refeição liberada, no horário de cada refeição permitida;
- fim do jejum, quando a janela abre (adiado para a hora de acordar se cair durante o sono);
- janela fechando, 30 minutos antes do fim.

Cada tipo pode ser desligado em Ajustes, Lembretes. O plano é refeito a cada mudança, ao abrir o app e ao voltar para ele. Com o app aberto, o lembrete de água aparece como aviso do sistema e também na tela, e registrar por um dos dois limpa o outro. Se o app ficar mais de quatro dias sem ser aberto (ou os 60 avisos acabarem antes), os avisos param até a próxima abertura.

## Refeições fora de hora e sono

- **Comi agora:** registra qualquer coisa que você comeu. Dá para marcar como lanche fora de hora (não muda nenhum horário) ou como uma refeição adiantada. No segundo caso o app mostra como o resto do dia ficaria e só muda com Confirmar; Manter horários registra a refeição sem mexer no resto.
- Depois de comer, a resposta fica NÃO pelo intervalo mínimo entre refeições, e o contador do jejum recomeça do último registro.
- **Modo noite:** dentro do horário de sono configurado, a tela Hoje mostra um aviso calmo, sem lembretes de água na tela. "Não consigo dormir" marca que você está acordado sem começar o dia de água.
- **Sono:** pela manhã o app estima quando você dormiu e acordou pelo uso do próprio app (só os horários de abertura, guardados por 3 dias no aparelho) e pede uma confirmação. Com o horário confirmado, o dia de água e os avisos começam na hora em que você acordou de verdade.
- **App Saúde (só no iPhone):** em Ajustes, Sono, "Usar sono do app Saúde" lê apenas os dados de sono (leitura, nunca escrita). Quando existe sono no app Saúde, ele vale mais que a estimativa e o app não pergunta.

## Corpo, energia e previsão

A aba Corpo registra peso (com edição e exclusão), altura, gordura corporal, data de nascimento e sexo. O peso mais recente também ajusta a meta de água.

- **Gasto do dia:** usa o app Saúde quando tem (total, ou repouso + ativo). Sem ele, estima o gasto em repouso pela fórmula de Mifflin St Jeor (média das fórmulas masculina e feminina quando o sexo não foi informado), multiplica pelo nível de atividade e soma os minutos de exercício. Para hoje, a previsão usa o repouso de um dia típico, o ativo até agora e o ativo típico que ainda falta (mediana dos últimos 7 dias).
- **Consumo do dia:** usa as calorias consumidas do app Saúde quando existem. Sem elas, soma as calorias típicas de cada refeição registrada (configuradas em Ajustes), vezes 0,7 / 1 / 1,3 para "menos / normal / mais". Dia de jejum total conta 0. Dias sem registro usam as refeições planejadas. A tela sempre mostra qual fonte foi usada.
- **Peso de gordura:** balanço (consumo menos gasto) dividido por 7700 kcal por kg.
- **Água e glicogênio:** um jejum de mais de 12h tira até 1,2 kg de água e glicogênio (o máximo a partir de 36h), que voltam depois de um dia de alimentação normal. Isso deixa a previsão realista depois de um dia de jejum e depois do dia em que você volta a comer.
- **Tendência:** média móvel exponencial das pesagens (fator 0,1). A projeção de 4 semanas usa o balanço médio dos últimos 14 dias quando há pelo menos 7 dias com registro; se não, usa a inclinação da tendência.
- **Meta:** a data estimada sai da projeção. Com menos de 3 pesagens, tendência para o lado errado ou prazo maior que 2 anos, o app diz que não dá para estimar.
- **Faixa da previsão:** fica mais larga quando há poucas pesagens nos últimos 30 dias.

Os pesos ficam guardados para sempre (são o seu histórico). Os totais diários de energia e atividade do app Saúde ficam por 180 dias. No PWA tudo é manual, e a previsão funciona com as estimativas.

### App Saúde por grupo

Em Ajustes, App Saúde, cada grupo começa desligado e pede só a leitura dos seus dados:

- Sono;
- Corpo: peso, altura, gordura;
- Atividade: calorias em repouso e ativas, total, passos, minutos de exercício e treinos;
- Alimentação: calorias consumidas.

"Salvar meu peso no app Saúde" pede permissão de escrita só para peso. Desligar um grupo apaga os dados daquele grupo que vieram do Saúde. "Apagar dados de corpo e atividade" remove o que veio do Saúde e mantém os pesos registrados no app.

## Horários de hoje

Toque no nome de uma refeição em Hoje para mudar o horário só de hoje (não aceita horário durante o sono e avisa se ficar fora da janela) ou voltar ao horário padrão. "Restaurar horários de hoje" desfaz todos os ajustes e o adiantamento da janela do dia. Ao abrir, o app descarta ajustes antigos que caiam no sono, antes de acordar ou fora da janela além da tolerância.

## Pipeline

- Push na `main` roda os testes e publica `www/` no GitHub Pages (`pages.yml`).
- Push na `main` que mexe em `www/`, `ios/`, `package.json`, `package-lock.json` ou `capacitor.config.json` gera o build iOS e envia para o TestFlight (`ios-testflight.yml`). Também dá para rodar na mão em Actions, iOS build to TestFlight, Run workflow.
- O número do build é o número da execução do workflow. A versão exibida vem de `MARKETING_VERSION` no projeto Xcode (hoje 1.0).
- O build do iOS roda em `macos-26` com o Xcode 26 mais novo instalado no runner, e mostra a versão no log.
- Os dois workflows instalam com `npm ci --ignore-scripts` e conferem as assinaturas dos pacotes com `npm audit signatures`.
- Sem os segredos configurados, o workflow do iOS termina verde com um aviso, sem tentar assinar.

## Configuração única (Apple e GitHub)

### App Store Connect e Apple Developer

1. Em Certificates, Identifiers & Profiles, Identifiers, registre o App ID explícito `com.staackyz.canieatnow`. Notificação local não precisa de Push Notifications.
   - **HealthKit (obrigatório desde a leitura de sono):** abra o identifier `com.staackyz.canieatnow`, marque **HealthKit** e clique em **Save** antes do próximo build. Sem isso a assinatura automática falha, porque o app agora pede o entitlement `com.apple.developer.healthkit` (`ios/App/App/App.entitlements`).
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
