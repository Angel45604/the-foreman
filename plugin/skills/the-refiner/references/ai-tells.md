# AI Writing Tells

A condensed taxonomy of patterns that mark prose as AI-generated. Each entry names the pattern, lists trigger phrases, and gives a short before and after fix.

When a span fits two groups, use the lower-numbered group.

## 1. Throat-clearing openers

- **Dive-in preamble**: opens with "Let's dive in," "Let's get started," or "Without further ado" before the actual point.
- **Manufactured candor**: "Here's the thing," "Truth be told," used to fake a moment of honesty that adds no information.
- **Faux-discovery lead**: "It turns out," "As it happens," "Interestingly enough," framing a plain fact as a surprise.
- **Confession opener**: "The uncomfortable truth is," "I'll be honest," borrowing the weight of a confession for an ordinary statement.
- **Scene-setting stall**: "Before we begin," "To set the stage," delaying the point instead of starting with it.

Before: "Let's dive in. The uncomfortable truth is the cache was never invalidated on write."
After: "The cache was never invalidated on write."

## 2. Chatbot artifacts and sycophancy

- **Praise-first opener**: "Great question," "Excellent point," complimenting the prompt before answering it.
- **Compliance flourish**: "Certainly!" "Absolutely!" "Of course!" as a stock acknowledgment with no content.
- **Service-desk sign-off**: "I hope this helps," "Let me know if you need anything else," closing every answer the same way regardless of content.
- **Eager-to-please opener**: "Happy to help," "I'd be glad to explain," announcing willingness instead of helping.
- **Unearned validation**: complimenting the person's idea, question, or code before addressing it, whether or not it merits praise.

Before: "Great question! Happy to help. Add an index on user_id and the query will speed up."
After: "Add an index on user_id; the query will speed up."

## 3. Jargon filler beyond the core list

The primary banned word list lives in this skill's references/core-contract.md. This group adds only the long tail that list does not name.

- **Fabric and scenery nouns**: tapestry, interplay, used as decoration rather than a real structure.
- **Weight-inflating adjective**: paramount, added to sound serious without adding a fact.
- **Formal connector filler**: moreover, furthermore, notwithstanding, stiff transition words that plain prose does not need.
- **Backward legal reference**: aforementioned, used to sound official instead of naming the thing again.
- **Loose scale claims**: burgeoning, ubiquitous, used as vague size words rather than a measured amount.

Before: "The interplay between the aforementioned services is paramount to the burgeoning platform."
After: "How these services interact is essential to the growing platform."

## 4. Hedge filler and false concessions

- **Notice-flag hedge**: "It's worth noting," "It should be noted," "Notably," flagging a point instead of just stating it.
- **Reversal hinge**: "That being said," "With that said," "Having said that," pivoting without adding new information.
- **Promise-then-pivot concession**: "While X is promising, Y remains a challenge," a template that sounds balanced but says nothing specific.
- **Preemptive disclaimer**: "It's important to remember that," "Keep in mind that," softening a plain statement before making it.
- **Both-sides padding**: listing a pro and a con with no actual stance, so the sentence reads as balanced but decides nothing.

Before: "It's worth noting that while the new cache is promising, cold starts remain a challenge."
After: "The new cache is promising, but cold starts remain a challenge."

## 5. Intensifier crutches and absolutes

- **Depth intensifiers**: deeply, profoundly, fundamentally, added before a claim to imply weight it has not earned.
- **Sincerity markers**: truly, genuinely, honestly, asserting sincerity instead of showing it.
- **Magnitude inflators**: incredibly, remarkably, extraordinarily, used on routine outcomes.
- **Misused literal**: "literally" attached to a figurative statement for emphasis.
- **Absolute-as-emphasis**: always, never, everyone, nothing, no one, used for rhetorical force rather than a checked fact.
- Sincerity markers and absolutes used as bare emphasis drop; factual absolutes ("all connections", "never released") and adjectives carrying a checkable magnitude claim (significant, strong) stay, stated plainly.

Before: "This is a deeply important fix that will literally always prevent the crash."
After: "This is an important fix that prevents the crash."

## 6. Structure tells

- **Rule-of-three padding**: three parallel adjectives or phrases stacked for rhythm, such as "faster, cleaner, and more reliable."
- **Binary contrast frame**: "It's not X, it's Y" or "not just X but Y," a template swapped in for a real distinction.
- **Self-answered question**: posing a question and immediately answering it as a rhetorical device rather than a real explanation.
- **Recap ending**: a closing paragraph that restates points the message already made.
- **Moralizing coda**: a final sentence that draws a life lesson from a technical fact.
- **Numbered throat-clear**: "Firstly," "Secondly," "Thirdly," padding structure on steps that are not actually sequential.

Before: "Why did the build fail? Because the lockfile was out of date. It's not just a bug, it's a lesson in dependency hygiene."
After: "The build failed because the lockfile was out of date."

## 7. Significance inflation and promotional voice

- **Legacy-weight nouns**: testament, milestone, pivotal moment, applied to routine work.
- **Fabric metaphors**: rich tapestry, woven together, dressing up an ordinary combination of parts.
- **Default superlative**: groundbreaking, revolutionary, game-changing, attached to incremental changes.
- **Frictionless-claim adverbs**: seamlessly, effortlessly, claiming ease the reader cannot verify.
- **Prestige adjectives**: world-class, best-in-class, industry-leading, asserted rather than demonstrated.

Before: "This groundbreaking update seamlessly delivers a world-class experience."
After: "This update delivers an experience."

## 8. Dangling participial analysis tails

- **Highlighting tail**: a fact sentence closed with "highlighting the importance of" some larger point the sentence did not earn.
- **Showcasing tail**: closed with "showcasing how" the fact proves a broader claim.
- **Underscoring tail**: closed with "underscoring the need for" some follow-up action.
- **Demonstrating tail**: closed with "demonstrating the value of" a method or decision.
- **Reflecting tail**: closed with "reflecting a broader shift toward" a trend the sentence never established.

Before: "Revenue grew 12% in Q3, highlighting the strength of the new pricing model."
After: "Revenue grew 12% in Q3. This result shows the strength of the new pricing model."

## 9. Vague attribution and false ranges

- **Anonymous authority**: "experts say," "critics argue," citing a group instead of naming a source.
- **Unsourced research claim**: "studies show," "research suggests," with no study named.
- **Crowd-consensus claim**: "it is widely accepted that," "most agree that," asserting consensus without evidence of one.
- **False-range breadth**: "from X to Y" used to imply wide coverage without listing what the range actually includes.
- **Vague plural sourcing**: "some say," "sources indicate," standing in for a real citation.

Before: "Studies show that teams from startups to enterprises love this approach."
After: "Unspecified studies claim that teams across company sizes love this approach. I did not verify the claim."

## 10. Punctuation tells

- **Em-dash reveal**: a sentence pauses, then an em dash drops in the real point as manufactured drama, instead of stating the point directly. The core contract bans the em dash in prose and keeps the en dash inside ranges, so flag the em dash, not every dash.
- **Reveal colon**: a colon set up the same way, as in "The result was clear: nothing changed," used as a dramatic beat rather than a genuine list or explanation.
- **Exclamation overuse**: exclamation marks on routine statements to manufacture energy the content does not have.
- **Boldface abuse**: bolding scattered words for emphasis instead of writing a clearer sentence.
- **Scare-quote hedge**: quotation marks around an ordinary word to imply irony or distance without saying why.

Before: "The tests passed. The real problem: the deploy script still failed."
After: "The tests passed, but the deploy script still failed."

Sources: unslop (MIT), SimpleEnglish (MIT), danyuchn/asd-ste100-skill (MIT), ASD-STE100 principles (paraphrased, no verbatim text).
