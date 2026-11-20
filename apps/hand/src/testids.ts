/**
 * Every `data-testid` the app uses, fixed in wave 2 (ARCHITECTURE §7, PLAN rule 12): one
 * constant per interactive element (and per state a test waits for) named in UX-SPEC, grouped by
 * screen. Values are `<screen>-<element>` in kebab case. An element repeated in a list (a chip,
 * a row, a hand on the rail) keeps one id and carries its value in `data-value` or its position
 * in `data-index`. A screen that needs an id missing here lists it in its build note and uses one
 * that follows this naming; the integrator adds it here.
 */
export const TID = {
  /** The frame (UX-SPEC §6). */
  shell: {
    ribbon: "shell-ribbon",
    header: "shell-header",
    logo: "shell-logo",
    langEn: "shell-lang-en",
    langRu: "shell-lang-ru",
    lens: "shell-lens",
    main: "shell-main",
    footer: "shell-footer",
    footerCore: "shell-footer-core",
    footerLimits: "shell-footer-limits",
    footerWithoutUs: "shell-footer-without-us",
    footerDefaults: "shell-footer-defaults",
    theme: "shell-theme",
    notFound: "shell-not-found",
    notFoundHome: "shell-not-found-home",
    crash: "shell-crash",
    crashRetry: "shell-crash-retry",
  },

  /** Landing `/` (§7.1). */
  landing: {
    hero: "landing-hero",
    gesture: "landing-gesture", // data-value: raise | pass | thank (a flip card)
    openInput: "landing-open-input",
    openSubmit: "landing-open-submit",
    otherSite: "landing-other-site",
    raise: "landing-raise",
    my: "landing-my",
    withoutUs: "landing-without-us",
  },

  /** Raise `/raise` (§7.2). */
  raise: {
    what: "raise-what",
    detailsToggle: "raise-details-toggle",
    details: "raise-details",
    rewardChip: "raise-reward-chip", // data-value: 5 | 20 | 50 | custom
    rewardCustom: "raise-reward-custom",
    noReward: "raise-no-reward",
    lockedLine: "raise-locked-line",
    issuerLine: "raise-issuer-line",
    expiryChip: "raise-expiry-chip", // data-value: 7 | 30 | 90 | 180
    nudge: "raise-nudge",
    visibility: "raise-visibility", // data-value: public | unlisted | dark
    unfurl: "raise-unfurl",
    fineTune: "raise-fine-tune",
    minClaim: "raise-min-claim",
    payoutRoom: "raise-payout-room",
    preview: "raise-preview",
    swipe: "raise-swipe",
    steps: "raise-steps",
    keysCard: "raise-keys-card",
    keysConfirm: "raise-keys-confirm",
    txRail: "raise-tx-rail",
    up: "raise-up",
    pending: "raise-pending",
    copy: "raise-copy",
    share: "raise-share",
    qr: "raise-qr",
    print: "raise-print",
    reminder: "raise-reminder",
    lockedCopy: "raise-locked-copy",
    savedTick: "raise-saved-tick",
    copyGone: "raise-copy-gone",
    error: "raise-error",
    cost: "raise-cost",
  },

  /** My hands `/my`, `/my/<chain>/<hand>` (§7.3). */
  my: {
    list: "my-list",
    item: "my-item", // data-value: handKey
    empty: "my-empty",
    deviceOnly: "my-device-only",
    unlock: "my-unlock",
    careBand: "my-care-band",
    showLink: "my-show-link",
    linkRow: "my-link-row",
    answers: "my-answers",
    answer: "my-answer",
    answerRefused: "my-answer-refused",
    answerThank: "my-answer-thank",
    replyInput: "my-reply-input",
    replySend: "my-reply-send",
    pasteAnswer: "my-paste-answer",
    addReward: "my-add-reward",
    keepOpen: "my-keep-open",
    print: "my-print",
    addByNumberInput: "my-add-by-number-input",
    addByNumberSubmit: "my-add-by-number-submit",
    addByNumberError: "my-add-by-number-error",
    deviceCode: "my-device-code",
    rebuildInput: "my-rebuild-input",
    rebuildSubmit: "my-rebuild-submit",
    passedItem: "my-passed-item",
  },

  /** Care `/care/<chain>/<hand>` (§7.4). */
  care: {
    fundInput: "care-fund-input",
    fundSwipe: "care-fund-swipe",
    extendChip: "care-extend-chip", // data-value: 30 | 90 | max
    extendSwipe: "care-extend-swipe",
    lastMinutes: "care-last-minutes",
    reminder: "care-reminder",
    error: "care-error",
    txRail: "care-tx-rail",
  },

  /** Thank `/thank` (§7.5). */
  thank: {
    input: "thank-input",
    open: "thank-open",
    checking: "thank-checking",
    resigned: "thank-resigned",
    droppedTick: "thank-dropped-tick", // data-index: the dropped holder
    anyway: "thank-anyway",
    firstSeen: "thank-first-seen",
    payeeRefused: "thank-payee-refused",
    payeeFlag: "thank-payee-flag",
    tooLong: "thank-too-long",
    setupBand: "thank-setup-band",
    twoSteps: "thank-two-steps",
    predicted: "thank-predicted",
    warning: "thank-warning",
    swipe: "thank-swipe",
    cost: "thank-cost",
    txRail: "thank-tx-rail",
    done: "thank-done",
    receipt: "thank-receipt",
    proof: "thank-proof",
    withoutUs: "thank-without-us",
    error: "thank-error",
  },

  /** Hand view `/#…`, `/<chain>/<hand>` (§8.1–8.3). */
  hand: {
    checking: "hand-checking",
    dealCard: "hand-deal-card",
    rail: "hand-rail",
    railHand: "hand-rail-hand", // data-index: position
    handsSoFar: "hand-hands-so-far",
    pass: "hand-pass",
    help: "hand-help",
    helpNote: "hand-help-note",
    passesLeft: "hand-passes-left",
    tabOnly: "hand-tab-only",
    lost: "hand-lost",
    noLink: "hand-no-link",
    closed: "hand-closed",
    newerLook: "hand-newer-look",
    newerCount: "hand-newer-count",
    newerFound: "hand-newer-found",
    newerNone: "hand-newer-none",
    askSender: "hand-ask-sender",
    giveLink: "hand-give-link",
    toThank: "hand-to-thank",
    timesUp: "hand-times-up",
    sendBack: "hand-send-back",
    wentBack: "hand-went-back",
    statements: "hand-statements",
    copy: "hand-copy",
    share: "hand-share",
    error: "hand-error",
    networkTime: "hand-network-time",
  },

  /** Pass on `/pass` (§8.4). */
  pass: {
    slider: "pass-slider",
    shareMoney: "pass-share-money",
    noReward: "pass-no-reward",
    darker: "pass-darker",
    swipe: "pass-swipe",
    copy: "pass-copy",
    share: "pass-share",
    qr: "pass-qr",
    qrTooLong: "pass-qr-too-long",
    readBack: "pass-read-back",
    error: "pass-error",
  },

  /** Give `/give` (§8.5). */
  give: {
    words: "give-words",
    agree: "give-agree",
    swipe: "give-swipe",
    setupBand: "give-setup-band",
    noForwarder: "give-no-forwarder",
    checking: "give-checking",
    delivered: "give-delivered",
    fallback: "give-fallback",
    copy: "give-copy",
    share: "give-share",
    qr: "give-qr",
    thread: "give-thread",
    replyInput: "give-reply-input",
    replySend: "give-reply-send",
    toWaiting: "give-to-waiting",
    error: "give-error",
  },

  /** Where the money lands, the shared sheet (§8.6). */
  land: {
    sheet: "land-sheet",
    wallet: "land-wallet",
    address: "land-address",
    addressInput: "land-address-input",
    addressProblem: "land-address-problem",
    keepKey: "land-keep-key",
    fresh: "land-new",
    words: "land-words",
    wordsTick: "land-words-tick",
    done: "land-done",
  },

  /** Waiting for you `/waiting` (§9). */
  waiting: {
    addressInput: "waiting-address-input",
    look: "waiting-look",
    connect: "waiting-connect",
    row: "waiting-row", // data-value: token address
    nothing: "waiting-nothing",
    takeOut: "waiting-take-out",
    takeOutTo: "waiting-take-out-to",
    deliver: "waiting-deliver",
    safe: "waiting-safe",
    friendLink: "waiting-friend-link",
    issuer: "waiting-issuer",
    withdrawn: "waiting-withdrawn",
    error: "waiting-error",
    txRail: "waiting-tx-rail",
    events: "waiting-events",
  },

  /** The passport `/<chain>/<hand>/proof` (§10.1). */
  proof: {
    check: "proof-check", // data-index: 1..11
    again: "proof-again",
    download: "proof-download",
    withoutSite: "proof-without-site",
    print: "proof-print",
    longRead: "proof-long-read",
  },

  /** Check any link `/check` (§10.2). */
  check: {
    input: "check-input",
    run: "check-run",
    ruler: "check-ruler",
    step: "check-step", // data-index: Core's order
    coreAnswer: "check-core-answer",
    finding: "check-finding",
  },

  /** This contract `/core` (§10.3). */
  core: {
    address: "core-address",
    domain: "core-domain",
    cap: "core-cap",
    derivation: "core-derivation",
    commit: "core-commit",
    buildHash: "core-build-hash",
    command: "core-command",
    copyCommand: "core-copy-command",
    limits: "core-limits",
  },

  /** `/limits`, `/defaults`, `/without-us` (§11). */
  about: {
    limit: "limits-entry", // data-index: 1..16
    default: "defaults-row", // data-value: the decision's number
    exitFile: "without-us-exit",
    command: "without-us-command",
    explorer: "without-us-explorer",
  },

  /** Print `/print` (§11). */
  print: {
    card: "print-card",
    tag: "print-tag",
    tooDense: "print-too-dense",
    go: "print-go",
  },

  /** The local dev wallet `/dev/wallet` (ARCHITECTURE §7, Wallets). */
  devWallet: {
    account: "dev-wallet-account", // data-value: the account's address
    sign: "dev-wallet-sign",
    approve: "dev-wallet-approve",
    networkTime: "dev-wallet-network-time",
    deviceTime: "dev-wallet-device-time",
  },

  /** The shared kit (ui/), wherever a screen mounts it. */
  kit: {
    connectSheet: "kit-connect-sheet",
    connectOption: "kit-connect-option", // data-value: the connector's id
    dealCard: "kit-deal-card",
    chainRail: "kit-chain-rail",
    flip: "kit-flip", // data-index: position
    receipt: "kit-receipt",
    receiptRow: "kit-receipt-row", // data-index
    txRail: "kit-tx-rail",
    txStep: "kit-tx-step", // data-value: sent | in-block | recorded | final
    costLine: "kit-cost-line",
    copyRow: "kit-copy-row",
    copyButton: "kit-copy-button",
    shareButton: "kit-share-button",
    qr: "kit-qr",
    mark: "kit-mark", // data-value: checked | on-chain | waiting
    disclose: "kit-disclose",
    errorBand: "kit-error-band",
    moneyInput: "kit-money-input",
    addressInput: "kit-address-input",
    sheet: "kit-sheet",
    sheetClose: "kit-sheet-close",
    withoutUs: "kit-without-us",
  },
} as const;

export type TestIds = typeof TID;
