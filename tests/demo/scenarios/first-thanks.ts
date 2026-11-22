import { defineScenario } from "../engine/scenario";

/** The flagship loop with three people: the asker, one holder who keeps a share, the helper. */
export default defineScenario({
  id: "first-thanks",
  title: "Raise, pass on with a share, answer, thank",
  story:
    "Nina needs a ladder. She raises a hand with 20 test dollars and sends the link to Alex. Alex has no wallet; he passes it on and keeps 10% for himself, paid to an address he pastes. Gina opens Alex's link, answers with her wallet, and Nina thanks her: one transaction pays Gina and Alex.",
  titleRu: "Поднять руку, передать с долей, ответить, поблагодарить",
  storyRu:
    "Нине нужна лестница. Она поднимает руку с наградой 20 тестовых долларов и отправляет ссылку Алексу. У Алекса нет кошелька: он передаёт ссылку дальше и оставляет себе 10% на адрес, который вставляет. Гина открывает ссылку Алекса и отвечает со своим кошельком, Нина благодарит её: одна транзакция платит и Гине, и Алексу.",
  covers: ["U1", "U4", "U28", "UX §7.2", "UX §8.4", "UX §8.5", "UX §7.5"],
  targets: ["stand", "fork", "site"],
  tags: ["core-loop", "unlisted", "walletless-pass"],
  personas: {
    nina: { name: "Nina", role: "asker", wallet: { kind: "dev", account: 1 } },
    alex: { name: "Alex", role: "holder", wallet: { kind: "none" } },
    gina: { name: "Gina", role: "helper", wallet: { kind: "dev", account: 4 } },
  },
  steps: [
    { do: "say", caption: "Three people, three phones. Nobody shares anything but a link.", captionRu: "Три человека, три телефона. Друг другу они передают только ссылку." },
    { who: "nina", do: "raise", title: "Who can lend a ladder in Batumi this weekend?", details: "Three metres is enough. I can pick it up.", titleRu: "Кто одолжит лестницу в Батуми на выходные?", detailsRu: "Хватит трёх метров. Заберу сама.", reward: "20", visibility: "unlisted", as: "ladder" },
    { who: "alex", do: "open", link: "ladder", caption: "Alex opens the link Nina sent him", captionRu: "Алекс открывает ссылку, которую прислала Нина" },
    { who: "alex", do: "pass", keepBps: 1000, payee: "fresh-address", as: "ladder-via-alex" },
    { who: "gina", do: "open", link: "ladder-via-alex", caption: "Gina opens the link Alex passed on: two hands on the rail", captionRu: "Гина открывает ссылку от Алекса: на пути две руки" },
    { who: "gina", do: "give", words: "I have a three-metre ladder near the boulevard; text me and I'll bring it.", payee: "wallet" },
    { who: "nina", do: "thank", hand: "ladder" },
  ],
  checks: [
    { hand: "ladder", state: "thanked" },
    { received: "alex", amount: "2" },
    { received: "gina", amount: "18" },
  ],
});
