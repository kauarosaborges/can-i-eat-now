> Vivo.

# Como instalar o Can I Eat Now? no iPhone

São dois jeitos. O app nativo (TestFlight) é o principal, porque é ele que notifica com o app fechado e sem internet. O web app serve para o PC e como plano B no iPhone.

## Parte 1: configuração única (faça no PC, uns 20 minutos)

### 1.1 Registrar o identificador do app

1. Abra developer.apple.com/account e entre com sua conta de desenvolvedor.
2. Vá em **Certificates, Identifiers & Profiles**, depois **Identifiers**, e clique no **+**.
3. Escolha **App IDs**, depois **App**, e clique em Continue.
4. Em Description escreva `Can I Eat Now`. Em Bundle ID escolha **Explicit** e escreva `com.staackyz.canieatnow`.
5. Não marque nenhuma capability (notificação local não precisa de Push). Clique em Continue e Register.
6. Ainda no site, abra **Membership details** e copie o **Team ID** (10 letras e números). Guarde.

### 1.2 Criar o app no App Store Connect

1. Abra appstoreconnect.apple.com, vá em **Apps** e clique no **+**, depois **New App**.
2. Preencha:
   - Platforms: **iOS**
   - Name: `Can I Eat Now?` (se o nome já existir na loja, use `Can I Eat Now? Jejum`; ele só aparece no TestFlight)
   - Primary Language: **Portuguese (Brazil)**
   - Bundle ID: escolha `com.staackyz.canieatnow` na lista
   - SKU: `can-i-eat-now`
   - User Access: **Full Access**
3. Clique em Create.

### 1.3 Gerar a chave da API para o GitHub

1. No App Store Connect, vá em **Users and Access**, aba **Integrations**, depois **App Store Connect API** e **Team Keys**. Se for a primeira vez, clique em Request Access e aceite.
2. Clique no **+** e dê o nome `GitHub CI`.
3. Em Access escolha **App Manager**. Se o build falhar depois com erro de permissão na assinatura, gere outra com **Admin** e troque.
4. Clique em Generate. Na lista, anote o **Key ID**. No topo da página, anote o **Issuer ID**.
5. Clique em **Download API Key** e salve o arquivo `AuthKey_XXXX.p8`. **Só dá para baixar uma vez.** Não coloque esse arquivo dentro da pasta do projeto nem mande para ninguém.

### 1.4 Colocar os segredos no GitHub

1. Abra github.com/kauarosaborges/can-i-eat-now, vá em **Settings** e depois **Environments**.
2. Abra o ambiente **testflight** (já existe; se não aparecer, clique em New environment e crie com esse nome).
3. Em **Deployment branches and tags**, escolha **Selected branches and tags** e adicione só `main`.
4. Em **Environment secrets**, clique em Add secret e crie os quatro:

| Nome | Valor |
|---|---|
| `APPLE_TEAM_ID` | o Team ID do passo 1.1 |
| `ASC_KEY_ID` | o Key ID do passo 1.3 |
| `ASC_ISSUER_ID` | o Issuer ID do passo 1.3 |
| `ASC_PRIVATE_KEY` | abra o `.p8` no Bloco de Notas e cole o conteúdo inteiro, incluindo as linhas `BEGIN` e `END` |

5. Depois de cadastrar, apague o `.p8` do computador ou guarde num gerenciador de senhas.

### 1.5 Gerar o primeiro build

1. No GitHub, abra **Actions**, escolha **iOS build to TestFlight** e clique em **Run workflow** na `main`.
2. Leva uns 15 minutos. Se ficar verde, a Apple ainda processa o build por mais 10 a 30 minutos.
3. Se ficar vermelho, me mande o link da execução.

### 1.6 Liberar para você no TestFlight

1. No App Store Connect, abra o app, aba **TestFlight**.
2. Em **Internal Testing**, clique no **+**, crie um grupo `Eu` e adicione seu próprio e-mail.
3. Marque o build que apareceu para esse grupo. Se pedir informação de criptografia, ela já vem respondida como "não usa".

## Parte 2: instalar no iPhone (5 minutos)

1. Instale o app **TestFlight** pela App Store.
2. Abra o e-mail de convite do TestFlight no iPhone e toque em **View in TestFlight**, ou abra o TestFlight e entre com o mesmo Apple ID.
3. Toque em **Install** no Can I Eat Now?.
4. Abra o app, faça a apresentação e, no último passo, permita as notificações.
5. Em **Ajustes do iPhone, Can I Eat Now?, Notificações**, deixe **Banners** como **Persistentes** se quiser que o aviso de água fique na tela até você tocar.

Cada build dura 90 dias. Todo push na `main` gera um novo, e o TestFlight atualiza sozinho se você ligar **Automatic Updates** na página do app dentro do TestFlight.

### O que esperar das notificações

- Água, refeição liberada, fim do jejum e janela fechando chegam com o app fechado e sem internet.
- No aviso de água dá para tocar e segurar e escolher **Bebi**, e a água é registrada sem abrir a tela de Água.
- O app agenda os avisos das próximas 96 horas sempre que você o abre ou muda algo. Se ficar mais de 4 dias sem abrir, os avisos param até a próxima abertura.

## Plano B: web app (PC e iPhone sem TestFlight)

Endereço: https://kauarosaborges.github.io/can-i-eat-now/

- **No PC (Chrome ou Edge):** abra o endereço e clique no ícone de instalar na barra de endereço.
- **No iPhone:** abra no **Safari**, toque em Compartilhar e depois **Adicionar à Tela de Início**.

No web app os lembretes só aparecem com ele aberto. Os dados do web app e do app nativo são separados, cada um guarda no próprio aparelho.
