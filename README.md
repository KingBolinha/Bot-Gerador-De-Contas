# Wolf Store Gerador

Bot Discord para painel e entrega de contas Rockstar.

## Recursos

- Comando `.gen rockstar` para enviar uma conta por DM.
- Slash command `/painelgenpremium` para abrir o painel profissional.
- Painel profissional com botoes `Gerar Rockstar`, `Adicionar contas` e `Ver estoque`.
- O botao `Ver estoque` envia a lista completa das contas na DM do dono.
- Estoque em `data/accounts/rockstar.txt`.
- Comando `.add rockstar email:senha` para administradores adicionarem contas.
- Comando `.stock rockstar` para consultar o estoque.
- Log de geracoes em `data/logs/generated-rockstar.log`.

## Instalar

1. Instale o Node.js 18 ou superior.
2. Rode:

```bash
npm install
```

3. Copie `.env.example` para `.env` e preencha:

```env
DISCORD_TOKEN=token_do_seu_bot
ADMIN_IDS=seu_id_do_discord
PREFIX=.
```

4. No portal do Discord Developer, ative o intent `Message Content Intent` no bot.
5. Na URL de convite do bot, marque os escopos `bot` e `applications.commands`.
6. Inicie:

```bash
npm start
```

## Como usar

Adicione contas em `data/accounts/rockstar.txt`, uma por linha:

```txt
email1:senha1
email2:senha2
```

No Discord:

```txt
.gen rockstar
/painelgenpremium
.painel
.add rockstar email:senha
.stock rockstar
```
