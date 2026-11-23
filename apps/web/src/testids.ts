/**
 * Every `data-testid` the app uses: one
 * constant per interactive element (and per state a test waits for) named in the design, grouped by
 * screen. Values are `<screen>-<element>` in kebab case. An element repeated in a list (a chip,
 * a row, a hand on the rail) keeps one id and carries its value in `data-value` or its position
 * in `data-index`. A screen that needs an id missing here lists it in its build note and uses one
 * that follows this naming; the integrator adds it here.
 */
export const TID = {
  /** The frame. */
  shell: {
    ribbon: "shell-ribbon",
    header: "shell-header",
    logo: "shell-logo",
    lang: "shell-lang", // the header's language bubble; data-value: the language in use; it opens the list
    langEn: "shell-lang-en", // an item of the opened list
    langRu: "shell-lang-ru",
    lens: "shell-lens",
    main: "shell-main",
    footer: "shell-footer",
    footerCore: "shell-footer-core",
    footerWithoutUs: "shell-footer-without-us",
    footerDefaults: "shell-footer-defaults",
    theme: "shell-theme",
    notFound: "shell-not-found",
    notFoundHome: "shell-not-found-home",
    crash: "shell-crash",
    crashRetry: "shell-crash-retry",
    offline: "shell-offline", // a screen whose code could not load; data-value: common.time.offline
    offlineRetry: "shell-offline-retry",
    explorer: "shell-explorer", // a link to the chain's explorer; data-value: the tx hash or address it opens
    faucets: "shell-faucets", // where this test network's money comes from
    noCore: "shell-no-core", // the build's Core has no code on its chain; data-value: the Core's address
    noCoreRetry: "shell-no-core-retry",
    personOpen: "shell-person-open", // the header's mark of a connected account; data-value: the viewer's address
    logIn: "shell-log-in", // the header's way in, with no account connected
    myHands: "shell-my-hands", // the header's link to this device's hands, with no account connected and a hand passed on from here
    person: "shell-person", // the open sheet; data-who: me | other
    personAddress: "shell-person-address",
    personLogIn: "shell-person-log-in",
    personLogOut: "shell-person-log-out",
    personPasskey: "shell-person-passkey", // an account whose wallet Privy keeps; data-value: its passkeys
    personPasskeyAdd: "shell-person-passkey-add",
    personBalance: "shell-person-balance", // data-value: the token's balance in its smallest units
    personWaiting: "shell-person-waiting",
    personHands: "shell-person-hands",
    personRaise: "shell-person-raise",
    personLens: "shell-person-lens",
  },

  /** Landing `/`. */
  landing: {
    hero: "landing-hero",
    gesture: "landing-gesture", // data-value: raise | pass | help | thank (a flip card)
    openInput: "landing-open-input",
    openSubmit: "landing-open-submit",
    otherSite: "landing-other-site",
    raise: "landing-raise",
    openAsk: "landing-open-ask", // the folded paste row: one question that opens the box
    sample: "landing-sample", // a Hand as the person it reaches sees it, with an example's words
    example: "landing-example", // one example Hand of the set; data-value is its id, data-current marks the one in turn
    sampleNext: "landing-sample-next", // brings the next example
    samplePause: "landing-sample-pause", // holds the examples where they are, and lets them go on; data-value: paused | running
  },

  /** Raise `/raise`. */
  raise: {
    nav: "raise-nav", // the strip of sections; each item carries data-section
    what: "raise-what",
    detailsToggle: "raise-details-toggle",
    details: "raise-details",
    rewardChip: "raise-reward-chip", // data-value: 5 | 20 | 50 | custom
    rewardCustom: "raise-reward-custom",
    noReward: "raise-no-reward",
    lockedLine: "raise-locked-line",
    issuerLine: "raise-issuer-line",
    expiryChip: "raise-expiry-chip", // data-value: 7 | 30 | 90 (days)
    expiryDate: "raise-expiry-date", // the date the days come to, beside the chips (data-value: 2027-04-01); it opens the calendar
    expiryCalendar: "raise-expiry-calendar", // the app's own month of days (ui/DayPick.tsx); data-min, data-max, data-value
    expiryLine: "raise-expiry-line", // what happens after the date, and that it can be extended; data-expiry: the expiry in seconds
    expiryUtc: "raise-expiry-utc", // where the reader's day of the expiry is not UTC's: the day the link's preview will show
    later: "raise-reward-later", // "You can add to it later."
    nudge: "raise-nudge",
    visibility: "raise-visibility", // data-value: public | unlisted | dark
    unfurl: "raise-unfurl",
    unfurlCard: "raise-unfurl-card",
    unfurlTitle: "raise-unfurl-title",
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
    qr: "raise-qr",
    print: "raise-print",
    reminder: "raise-reminder",
    lockedCopy: "raise-locked-copy",
    savedTick: "raise-saved-tick",
    copyGone: "raise-copy-gone",
    error: "raise-error",
    cost: "raise-cost",
    title: "raise-title",
    titleCount: "raise-title-count", // data-value: characters; data-over
    detailsCount: "raise-details-count", // data-value: characters; data-over
    tooLong: "raise-too-long", // data-value: what is over its cap
    keysWhat: "raise-keys-what",
    pendingConnect: "raise-pending-connect",
    stopWaiting: "raise-stop-waiting",
    unknown: "raise-unknown",
    dropped: "raise-dropped",
    offline: "raise-offline",
    size: "raise-size", // data-value: characters before `#` in the public address (weigh); data-over: true | false
    accountChanged: "raise-account-changed",
    allowSent: "raise-allow-sent",
  },

  /** My hands `/my`, `/my/<chain>/<hand>`. */
  my: {
    list: "my-list",
    item: "my-item", // data-value: handKey
    empty: "my-empty",
    raise: "my-raise", // the empty list's swipe to /raise
    deviceOnly: "my-device-only",
    unlock: "my-unlock",
    careBand: "my-care-band",
    showLink: "my-show-link",
    lockedCopy: "my-locked-copy", // the link comes from the raise's locked copy on this device
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
    rebuildHand: "my-rebuild-hand",
    rebuildResult: "my-rebuild-result",
    rebuildError: "my-rebuild-error", // data-value: the message id
    rebuildOpen: "my-rebuild-open",
    linkRefused: "my-link-refused",
    answerCount: "my-answer-count", // data-value: accepted answers
    proofLink: "my-proof-link",
    answersMine: "my-answers-mine",
    answerMine: "my-answer-mine",
    answerThread: "my-answer-thread",
    thankOnWay: "my-thank-on-way",
    raiseDropped: "my-raise-dropped",
  },

  /** Care `/care/<chain>/<hand>`. */
  care: {
    fundInput: "care-fund-input",
    fundSwipe: "care-fund-swipe",
    extendChip: "care-extend-chip", // data-value: 30 | 90 | max
    extendSwipe: "care-extend-swipe",
    lastMinutes: "care-last-minutes",
    reminder: "care-reminder",
    error: "care-error",
    txRail: "care-tx-rail",
    fundDone: "care-tx-rail-fund-done",
    extendDone: "care-tx-rail-extend-done",
    words: "care-words", // data-value: device | unknown | mismatch
    inFlight: "care-in-flight", // data-value: fund | extend
    unknown: "care-unknown",
  },

  /** Thank `/thank`. */
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
    keyFlag: "thank-key-flag",
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
    dropped: "thank-dropped", // data-index, data-payee, data-bps: a holder the re-signed route drops
    predictedRow: "thank-predicted-row", // data-kind, data-payee, data-amount
    noReward: "thank-no-reward",
    payout: "thank-payout", // data-kind: paid | waiting; data-payee, data-amount, data-landed
    noMoney: "thank-no-money",
    receiptEvent: "thank-receipt-event", // data-value: the event's name
    spent: "thank-spent", // data-status: reading | read | unread; once read: data-count, data-gas-used, data-fee
    spentSentence: "thank-spent-sentence",
    spentTx: "thank-spent-tx", // data-hash, data-from, data-block, data-gas-used, data-fee
    onWay: "thank-on-way", // data-value: the inbox record's id
    unknown: "thank-unknown",
  },

  /** Hand view `/#…`, `/<chain>/<hand>`. */
  hand: {
    checking: "hand-checking",
    dealCard: "hand-deal-card",
    rail: "hand-rail",
    railHand: "hand-rail-hand", // data-index: position
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
    newerFailed: "hand-newer-failed",
    askSender: "hand-ask-sender",
    giveLink: "hand-give-link",
    toThank: "hand-to-thank",
    timesUp: "hand-times-up",
    sendBack: "hand-send-back",
    wentBack: "hand-went-back",
    statements: "hand-statements",
    copy: "hand-copy",
    error: "hand-error",
    networkTime: "hand-network-time",
    unreachable: "hand-unreachable", // data-held, data-code
    retry: "hand-retry",
    actionBar: "hand-action-bar",
    proofLink: "hand-proof-link",
    checkLink: "hand-check-link",
    offline: "hand-offline",
    giveRefused: "hand-give-refused",
    sendBackInFlight: "hand-send-back-in-flight",
    sendBackRail: "hand-send-back-rail",
  },

  /** Pass on `/pass`. */
  pass: {
    slider: "pass-slider",
    shareMoney: "pass-share-money",
    noReward: "pass-no-reward",
    darker: "pass-darker",
    swipe: "pass-swipe",
    copy: "pass-copy",
    qr: "pass-qr",
    qrTooLong: "pass-qr-too-long",
    readBack: "pass-read-back",
    error: "pass-error",
  },

  /** Give `/give`. */
  give: {
    words: "give-words",
    agree: "give-agree",
    swipe: "give-swipe",
    setupBand: "give-setup-band",
    noForwarder: "give-no-forwarder",
    checking: "give-checking",
    delivered: "give-delivered",
    thanked: "give-thanked", // the asker thanked this very answer
    fallback: "give-fallback",
    copy: "give-copy",
    qr: "give-qr",
    thread: "give-thread",
    replyInput: "give-reply-input",
    replySend: "give-reply-send",
    toWaiting: "give-to-waiting",
    error: "give-error",
    askerHop: "give-asker-hop", // data-value: the passes (1-based) at the asker's own address
    wrongNetwork: "give-wrong-network",
  },

  /** Where the money lands, the shared sheet. */
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

  /** Waiting for you `/waiting`. */
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
    inFlight: "waiting-in-flight",
    unknown: "waiting-unknown",
  },

  /** The passport `/<chain>/<hand>/proof`. */
  proof: {
    check: "proof-check", // data-index: 1..11
    again: "proof-again",
    download: "proof-download",
    withoutSite: "proof-without-site",
    print: "proof-print",
    longRead: "proof-long-read",
    tally: "proof-tally",
    givehashMatches: "proof-givehash-matches",
    verifyLine: "proof-verify-line",
    sent: "proof-sent",
    move: "proof-move", // data-found, data-log, data-to, data-amount
    coreCaveat: "proof-core-caveat",
    coreCommand: "proof-core-command",
    codeHashes: "proof-code-hashes",
    askerHop: "proof-asker-hop", // data-value: the line's id (route.i or share.i) that names the asker's own address
  },

  /** Check any link `/check`. */
  check: {
    input: "check-input",
    run: "check-run",
    ruler: "check-ruler",
    step: "check-step", // data-index: Core's order
    coreAnswer: "check-core-answer",
    finding: "check-finding",
    agree: "check-agree",
    handNow: "check-hand-now", // data-state, data-block
    handState: "check-hand-state", // data-value: open | thanked | refunded | expired
    passport: "check-passport",
    offline: "check-offline", // data-passes, data-left
    offlineBand: "check-offline-band",
    offlinePass: "check-offline-pass", // data-index, data-kept, data-next
    retry: "check-retry",
  },

  /** This contract `/core`. */
  core: {
    address: "core-address",
    absent: "core-absent", // eth_getCode found no code at the address on this network
    domain: "core-domain",
    cap: "core-cap",
    derivation: "core-derivation",
    commit: "core-commit",
    buildHash: "core-build-hash",
    command: "core-command",
    copyCommand: "core-copy-command",
    limits: "core-limits",
    buildLabel: "core-build-label",
    buildValue: "core-build-value",
    unaudited: "core-unaudited",
    limitHere: "core-limit-here", // data-value: paid passes at worst; data-gas-k
  },

  /** `/defaults`, `/without-us`. */
  about: {
    default: "defaults-row", // data-value and data-key: the row's catalogue key
    exitFile: "without-us-exit",
    command: "without-us-command",
    explorer: "without-us-explorer",
    download: "without-us-download",
    core: "without-us-core",
  },

  /** Print `/print`. */
  print: {
    card: "print-card",
    tag: "print-tag",
    tooDense: "print-too-dense",
    go: "print-go",
    paste: "print-paste",
    open: "print-open",
    receipt: "print-receipt",
    verify: "print-verify",
    header: "print-header",
  },

  /** The twist: every hand and receipt row turns over to its proof. */
  twist: {
    flip: "twist-flip",
    front: "twist-flip-front",
    back: "twist-back",
    step: "twist-step",
    core: "twist-core",
    share: "twist-share",
    payee: "twist-payee",
    key: "twist-key",
    signer: "twist-signer",
    givehash: "twist-givehash",
    match: "twist-match",
    hand: "twist-hand",
    formula: "twist-formula",
    event: "twist-event",
    sweep: "twist-sweep",
    bow: "twist-bow",
    replay: "twist-replay",
  },

  /** The local dev wallet `/dev/wallet` (Wallets). */
  devWallet: {
    account: "dev-wallet-account", // data-value: the account's address
    sign: "dev-wallet-sign",
    approve: "dev-wallet-approve",
    networkTime: "dev-wallet-network-time",
    deviceTime: "dev-wallet-device-time",
    signature: "dev-wallet-signature", // data-index: 1 | 2, data-value: the signature
    verdict: "dev-wallet-verdict", // data-value: same | different
    wrapped: "dev-wallet-wrapped", // data-value: true | false
    ahead: "dev-wallet-ahead", // data-value: seconds the network is ahead
    hash: "dev-wallet-hash",
    sample: "dev-wallet-sample",
    sayNo: "dev-wallet-say-no",
  },

  /** The wallet layer (wallet/ConnectSheet.tsx), wherever a screen mounts it. */
  wallet: {
    connect: "connect-wallet",
    connected: "wallet-connected", // data-value: the connected address
    devAccount: "dev-account", // + "-<n>" | "-not-set-up" (tests/e2e/lib/accounts.ts)
    privyStatus: "privy-status", // "Opening log in…" while Privy loads (data-value "failed": the login did not finish), in a build whose configuration has `privy`
    linkAgain: "privy-link-again", // back from a social login with no link open: open it once more
  },

  /** The shared kit (ui/), wherever a screen mounts it. */
  kit: {
    connectSheet: "kit-connect-sheet",
    connectOption: "kit-connect-option", // data-value: the connector's id
    dealCard: "kit-deal-card",
    chainRail: "kit-chain-rail",
    railFlag: "kit-rail-flag", // a hand at the asker's own address (its <li> has data-flag="asker")
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
    dealWordsLabel: "kit-deal-words-label",
    dealReadAll: "kit-deal-read-all",
    dealOfWhole: "kit-deal-of-whole", // beside the amount that reaches the helper: the whole reward and what was kept
    railPerson: "kit-rail-person", // a hand on the rail that opens its person (calm view, address known)
    dealRaiser: "kit-deal-raiser", // the line over the asker's words, where it opens the asker as a person
    spine: "kit-spine", // the receiver's card drawn as the route's spine (calm view); data-value: hands on the route
    spineFold: "kit-spine-fold", // the line that counts who passed it on and opens them; data-value: how many
    spineKept: "kit-spine-kept", // what those passes kept
    spineWhole: "kit-spine-whole", // the whole reward, at the asker (left out where the viewer's own beat shows that amount)
    spineFar: "kit-spine-far", // after the date: how far off it is by the chain's clock
    spinePass: "kit-spine-pass", // one pass, once the line is open; data-index: its place among the passes
    spinePerson: "kit-spine-person", // a pass's name where its address is known: it opens that person
    dealAmountFlag: "kit-deal-amount-flag",
    dealHiddenChars: "kit-deal-hidden-chars",
    txOffline: "kit-tx-offline",
  },
} as const;

export type TestIds = typeof TID;
