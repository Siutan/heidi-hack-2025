import { keyboard, Key } from '@computer-use/nut-js';
import { GeminiVisionRPA } from './emr';

export const generateMockData = (): string => {
  return `Doctor: Good morning, Mr. Martinez. How have you been feeling since your last visit?

Patient: Morning, Dr. Chen. Well, mostly okay, but I've been having some chest tightness the past week or so. It's been worrying me.

Doctor: I can understand your concern. Tell me more about this chest tightness. When does it happen?

Patient: Usually when I'm walking upstairs or doing yard work. It feels like pressure across my chest, maybe lasts a few minutes, then goes away when I rest.

Doctor: Does it radiate anywhere? To your arm, jaw, or back?

Patient: Sometimes to my left arm, yeah. Not every time though.

Doctor: Any shortness of breath, nausea, or sweating with it?

Patient: A little short of breath, yes. No nausea though.

Doctor: Okay. Have you been taking your blood pressure medications regularly?

Patient: Yes, mostly. I'll be honest, I missed a few doses of the water pill last week because I ran out and didn't refill it right away.

Doctor: Which medications are you currently taking?

Patient: Let me see... I've got the lisinopril, that's 20 milligrams once a day. The hydrochlorothiazide, which is 25 milligrams. And the atorvastatin for my cholesterol, that's 40 milligrams at bedtime.

Doctor: Good. And you said you missed doses of the hydrochlorothiazide?

Patient: Yeah, for about four or five days last week.

Doctor: Alright. Any other medications? Over-the-counter or supplements?

Patient: Just the baby aspirin, 81 milligrams daily. And I take vitamin D, 2000 units.

Doctor: Good. Let me check your blood pressure now. *pause* It's 168 over 94 today, which is quite elevated. Your pulse is 88. Let me listen to your heart and lungs.

*Examination sounds*

Doctor: Take a deep breath for me. Good. Again. Your lungs sound clear. Heart sounds normal, no murmurs. Mr. Martinez, given your symptoms of chest pressure with exertion that goes away with rest, along with your risk factors - you have high blood pressure, high cholesterol, you're 57, and you mentioned you used to smoke - I'm concerned this could be angina, which is chest pain from your heart not getting enough blood flow.

Patient: Oh, that doesn't sound good. Is that like a heart attack?

Doctor: It's not a heart attack, but it's a warning sign that we need to take seriously. I want to do some tests. First, I'm going to order an EKG right now, then blood work including a troponin level to check for any heart muscle damage, and I want you to have a stress test within the next week.

Patient: Okay, whatever you think is best.

Doctor: In the meantime, I'm going to make some changes to your medications. First, I want you to continue the lisinopril 20 milligrams once daily, but I'm going to increase it to 40 milligrams once daily instead. This will help better control your blood pressure.

Patient: Okay, so double what I'm taking now?

Doctor: Exactly. For the hydrochlorothiazide, continue 25 milligrams once daily in the morning, but please make sure you don't miss doses. It's important to take it consistently.

Patient: Got it. I'll set a reminder on my phone.

Doctor: Good idea. Keep taking the atorvastatin 40 milligrams at bedtime. That's helping your cholesterol. And continue the aspirin 81 milligrams daily - that's very important for your heart.

Patient: What about for the chest pain?

Doctor: I'm going to start you on a new medication called nitroglycerin. This is a sublingual tablet, which means you put it under your tongue. I'm prescribing 0.4 milligrams tablets. If you have chest pain, you sit down, place one tablet under your tongue. If the pain doesn't go away after 5 minutes, take a second tablet. If it still doesn't go away after another 5 minutes, take a third tablet and call 911. Don't take more than three tablets.

Patient: Under my tongue, got it. How many times can I use this?

Doctor: You can use it as needed for chest pain, but if you're needing to use it frequently - more than a couple times a week - you need to call me right away. I'm also going to add a longer-acting medication. I'm starting you on metoprolol succinate, extended release, 50 milligrams once daily in the morning. This is a beta blocker that will help reduce your heart's workload and should help prevent the chest pain.

Patient: So that's a new one too? Metoprolol?

Doctor: Yes, metoprolol succinate ER 50 milligrams once daily. Take it with food. It may make you feel a little tired at first, but that usually improves. Don't stop it suddenly - if you have any issues, call me first.

Patient: Okay. So just to make sure I have this right - I'm increasing the lisinopril, continuing the water pill and the cholesterol medicine and aspirin, and adding two new ones - the nitroglycerin under the tongue for chest pain, and the metoprolol every morning?

Doctor: Perfect, you've got it. Let me also give you one more thing. I want you to take amlodipine 5 milligrams once daily as well. This is another blood pressure medicine that works differently than the others and will help us get better control.

Patient: Another new one? So that's three new medications?

Doctor: Yes - the nitroglycerin as needed for chest pain, metoprolol 50 milligrams daily, and amlodipine 5 milligrams daily. Along with continuing your current medications at the adjusted doses.

Patient: Alright, I can do that.`;
};

export const performAutomation = async (conversation: string, sourceId?: string): Promise<void> => {
  console.log("Starting automation with conversation length:", conversation?.length);
  
  // Give user time to focus the window
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  keyboard.config.autoDelayMs = 10;

  try {
    const rpa = new GeminiVisionRPA();
    await rpa.execute(conversation, sourceId);
  } catch (e: any) {
    console.error("Automation failed:", e);
    throw e; // Re-throw to be caught by main process handler
  }
};
