const fs = require("node:fs/promises");
const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");
require("dotenv").config();

const config = require("../config.json");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel]
});

const rootDir = path.resolve(__dirname, "..");
const prefix = (process.env.PREFIX || config.prefix || ".").trim();
const adminIds = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);
let generationQueue = Promise.resolve();

function serviceConfig(serviceName) {
  return config.services[serviceName.toLowerCase()];
}

function absoluteFromRoot(filePath) {
  return path.join(rootDir, filePath);
}

function cleanStockLines(raw) {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

async function readStock(service) {
  const stockPath = absoluteFromRoot(service.stockFile);

  try {
    const raw = await fs.readFile(stockPath, "utf8");
    return cleanStockLines(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.mkdir(path.dirname(stockPath), { recursive: true });
      await fs.writeFile(stockPath, "", "utf8");
      return [];
    }

    throw error;
  }
}

async function writeStock(service, accounts) {
  const stockPath = absoluteFromRoot(service.stockFile);
  await fs.mkdir(path.dirname(stockPath), { recursive: true });
  await fs.writeFile(stockPath, `${accounts.join("\n")}${accounts.length ? "\n" : ""}`, "utf8");
}

async function addAccountsToStock(service, accounts) {
  const stock = await readStock(service);
  const updatedStock = stock.concat(accounts);
  await writeStock(service, updatedStock);
  return updatedStock.length;
}

async function appendGenerationLog(service, user, account) {
  const logPath = absoluteFromRoot(service.generatedLogFile);
  const timestamp = new Date().toISOString();
  const maskedAccount = account.replace(/^(.{2}).*(@?.*)$/, "$1***$2");
  const line = `[${timestamp}] ${user.tag} (${user.id}) generated ${maskedAccount}\n`;

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, line, "utf8");
}

async function reserveAccount(serviceName) {
  const service = serviceConfig(serviceName);

  if (!service) {
    return { ok: false, reason: "unknown-service" };
  }

  const stock = await readStock(service);

  if (stock.length === 0) {
    return { ok: false, reason: "empty-stock", service };
  }

  const [account, ...remaining] = stock;
  return { ok: true, account, remaining, service };
}

function publicSuccessEmbed(service) {
  return new EmbedBuilder()
    .setColor(config.colors.success)
    .setTitle(`${config.storeName} | Conta gerada com êxito`)
    .setDescription(
      [
        `:Verified_Wolf: | Pronto, o serviço **${service.displayName}** que você selecionou, já foi gerado e já está em seu privado.`
      ].join("\n")
    )
    .setTimestamp();
}

function dmAccountEmbed(service, account, user) {
  return new EmbedBuilder()
    .setColor(config.colors.dm)
    .setTitle(`${config.storeName} | Conta gerada com exito`)
    .setDescription(
      [
        `\`\`\`${account}\`\`\``,
        `**Servico selecionado:** \`${service.displayName}\``,
        `**Autor:** ${user}`,
        "",
        "OBS: Caso voce seja mobile, basta pressionar em cima do login."
      ].join("\n")
    )
    .setImage(config.accountImageUrl)
    .setTimestamp();
}

function errorEmbed(title, description) {
  return new EmbedBuilder()
    .setColor(config.colors.error)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(config.colors.panel)
    .setTitle("Painel Gerador Premium")
    .setDescription(
      [
        "Gerencie o gerador Rockstar com total liberdade.",
        "",
        "**Servico:** Rockstar",
        "**Entrega:** privado do Discord",
        "**Estoque:** contas adicionadas pelo painel ou arquivo",
        "**Comando rapido:** `.gen rockstar`"
      ].join("\n")
    )
    .setFooter({ text: config.storeName })
    .setTimestamp();
}

function panelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("generate:rockstar")
      .setLabel("Gerar Rockstar")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("addstock:rockstar")
      .setLabel("Adicionar contas")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("stock:rockstar")
      .setLabel("Ver estoque")
      .setStyle(ButtonStyle.Secondary)
  );
}

function addAccountsModal(serviceName) {
  return new ModalBuilder()
    .setCustomId(`addstock:${serviceName}`)
    .setTitle("Adicionar contas Rockstar")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("accounts")
          .setLabel("Contas, uma por linha")
          .setPlaceholder("email1:senha1")
          .setRequired(true)
          .setStyle(TextInputStyle.Paragraph)
      )
    );
}

async function registerApplicationCommands(readyClient) {
  await readyClient.application.commands.set([
    {
      name: "painelgenpremium",
      description: "Envia o painel premium do gerador Rockstar"
    }
  ]);
}

async function replyToTarget(target, payload, ephemeral = false) {
  const options = { ...payload };

  if (typeof target.isButton === "function") {
    options.ephemeral = ephemeral;
  }

  return target.reply(options);
}

async function sendGeneratedAccount(target, user, serviceName) {
  const run = generationQueue.then(() => handleGeneratedAccountRequest(target, user, serviceName));
  generationQueue = run.catch(() => {});
  return run;
}

async function handleGeneratedAccountRequest(target, user, serviceName) {
  const result = await reserveAccount(serviceName);

  if (!result.ok && result.reason === "unknown-service") {
    await replyToTarget(
      target,
      { embeds: [errorEmbed("Servico nao encontrado", "Use `.gen rockstar` para gerar uma conta Rockstar.")] },
      true
    );
    return;
  }

  if (!result.ok && result.reason === "empty-stock") {
    await replyToTarget(
      target,
      { embeds: [errorEmbed("Estoque vazio", `O estoque de **${result.service.displayName}** esta vazio no momento.`)] },
      true
    );
    return;
  }

  try {
    await user.send({ embeds: [dmAccountEmbed(result.service, result.account, user)] });
  } catch {
    await replyToTarget(
      target,
      {
        embeds: [
          errorEmbed(
            "Nao consegui enviar DM",
            "Ative suas mensagens diretas neste servidor e tente gerar novamente. A conta nao foi entregue."
          )
        ]
      },
      true
    );
    return;
  }

  await writeStock(result.service, result.remaining);
  await appendGenerationLog(result.service, user, result.account);

  await replyToTarget(target, { embeds: [publicSuccessEmbed(result.service)] }, true);
}

async function replyStock(target, serviceName) {
  const service = serviceConfig(serviceName);
  const user = target.author || target.user;

  if (!isAdmin(user.id)) {
    await replyToTarget(
      target,
      { embeds: [errorEmbed("Sem permissao", "Apenas administradores podem ver o estoque completo.")] },
      true
    );
    return;
  }

  if (!service) {
    await replyToTarget(
      target,
      { embeds: [errorEmbed("Servico nao encontrado", "Use `.stock rockstar` para consultar o estoque Rockstar.")] },
      true
    );
    return;
  }

  const stock = await readStock(service);
  const stockText = stock.length > 0 ? stock.join("\n") : "Estoque vazio.";

  try {
    await sendLongDm(
      user,
      `${config.storeName} | Estoque ${service.displayName}`,
      stockText
    );
  } catch {
    await replyToTarget(
      target,
      {
        embeds: [
          errorEmbed(
            "Nao consegui enviar DM",
            "Ative suas mensagens diretas neste servidor para receber a lista do estoque."
          )
        ]
      },
      true
    );
    return;
  }

  await replyToTarget(
    target,
    {
      embeds: [
        new EmbedBuilder()
          .setColor(config.colors.panel)
          .setTitle(`${config.storeName} | Estoque`)
          .setDescription(`Enviei no seu privado a lista com **${stock.length}** conta(s) de **${service.displayName}**.`)
          .setTimestamp()
      ]
    },
    true
  );
}

async function sendLongDm(user, title, text) {
  const maxChunkLength = 1800;
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let currentChunk = "";

  for (const line of lines) {
    const nextChunk = currentChunk ? `${currentChunk}\n${line}` : line;

    if (nextChunk.length > maxChunkLength) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk = nextChunk;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  for (let index = 0; index < chunks.length; index += 1) {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(config.colors.dm)
          .setTitle(chunks.length > 1 ? `${title} (${index + 1}/${chunks.length})` : title)
          .setDescription(`\`\`\`\n${chunks[index]}\n\`\`\``)
          .setTimestamp()
      ]
    });
  }
}

function isAdmin(userId) {
  return adminIds.has(userId);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`${readyClient.user.tag} esta online.`);

  registerApplicationCommands(readyClient)
    .then(() => console.log("Comando /painelgenpremium registrado."))
    .catch((error) => console.error("Nao consegui registrar os comandos slash:", error));
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot || !message.content.startsWith(prefix)) return;

  const [command, serviceName, ...rest] = message.content.slice(prefix.length).trim().split(/\s+/);
  const normalizedCommand = command?.toLowerCase();
  const normalizedService = serviceName?.toLowerCase();

  try {
    if (normalizedCommand === "gen") {
      await sendGeneratedAccount(message, message.author, normalizedService || "");
      return;
    }

    if (normalizedCommand === "painel" || normalizedCommand === "panel") {
      if (!isAdmin(message.author.id)) {
        await message.reply({ embeds: [errorEmbed("Sem permissao", "Apenas administradores podem enviar o painel.")] });
        return;
      }

      await message.channel.send({ embeds: [panelEmbed()], components: [panelButtons()] });
      await message.delete().catch(() => {});
      return;
    }

    if (normalizedCommand === "stock") {
      await replyStock(message, normalizedService || "rockstar");
      return;
    }

    if (normalizedCommand === "add") {
      if (!isAdmin(message.author.id)) {
        await message.reply({ embeds: [errorEmbed("Sem permissao", "Apenas administradores podem adicionar contas.")] });
        return;
      }

      const service = serviceConfig(normalizedService || "");
      const account = rest.join(" ").trim();

      if (!service || !account) {
        await message.reply({
          embeds: [errorEmbed("Uso incorreto", "Use `.add rockstar email:senha` para adicionar uma conta ao estoque.")]
        });
        return;
      }

      const stockCount = await addAccountsToStock(service, [account]);
      await message.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle("Conta adicionada")
            .setDescription(`O estoque de **${service.displayName}** agora tem **${stockCount}** conta(s).`)
            .setTimestamp()
        ]
      });
    }
  } catch (error) {
    console.error(error);
    await message.reply({ embeds: [errorEmbed("Erro interno", "Nao consegui concluir essa acao agora.")] }).catch(() => {});
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "painelgenpremium") return;

      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({
          embeds: [errorEmbed("Sem permissao", "Apenas administradores podem enviar o painel.")],
          ephemeral: true
        });
        return;
      }

      await interaction.reply({ embeds: [panelEmbed()], components: [panelButtons()] });
      return;
    }

    if (interaction.isModalSubmit()) {
      const [action, serviceName] = interaction.customId.split(":");

      if (action !== "addstock") return;

      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({
          embeds: [errorEmbed("Sem permissao", "Apenas administradores podem adicionar contas.")],
          ephemeral: true
        });
        return;
      }

      const service = serviceConfig(serviceName);
      const accounts = cleanStockLines(interaction.fields.getTextInputValue("accounts"));

      if (!service || accounts.length === 0) {
        await interaction.reply({
          embeds: [errorEmbed("Nada para adicionar", "Envie pelo menos uma conta valida para o estoque Rockstar.")],
          ephemeral: true
        });
        return;
      }

      const stockCount = await addAccountsToStock(service, accounts);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(config.colors.success)
            .setTitle("Contas adicionadas")
            .setDescription(
              `Foram adicionada(s) **${accounts.length}** conta(s). O estoque de **${service.displayName}** agora tem **${stockCount}** conta(s).`
            )
            .setTimestamp()
        ],
        ephemeral: true
      });
      return;
    }

    if (!interaction.isButton()) return;

    const [action, serviceName] = interaction.customId.split(":");

    if (action === "generate") {
      await sendGeneratedAccount(interaction, interaction.user, serviceName);
    }

    if (action === "addstock") {
      if (!isAdmin(interaction.user.id)) {
        await interaction.reply({
          embeds: [errorEmbed("Sem permissao", "Apenas administradores podem adicionar contas.")],
          ephemeral: true
        });
        return;
      }

      await interaction.showModal(addAccountsModal(serviceName));
    }

    if (action === "stock") {
      await replyStock(interaction, serviceName);
    }
  } catch (error) {
    console.error(error);
    await interaction
      .reply({ embeds: [errorEmbed("Erro interno", "Nao consegui concluir essa acao agora.")], ephemeral: true })
      .catch(() => {});
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error("Defina DISCORD_TOKEN no arquivo .env antes de iniciar o bot.");
  process.exit(1);
}

if (adminIds.size === 0) {
  console.warn("Nenhum ADMIN_IDS definido. Comandos .painel e .add ficarao bloqueados.");
}

client.login(process.env.DISCORD_TOKEN);
