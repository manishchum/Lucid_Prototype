import re
import numpy as np
from analysis.models import bge_model

STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "is", "are", "was", "were", "to", "for", 
    "in", "on", "at", "by", "of", "with", "from", "as", "about", "this", "that", 
    "these", "those", "i", "you", "he", "she", "it", "we", "they", "me", "him", 
    "her", "us", "them", "my", "your", "his", "its", "our", "their", "be", "been", 
    "being", "have", "has", "had", "do", "does", "did", "will", "would", "shall", 
    "should", "can", "could", "may", "might", "must", "how", "what", "why", "where",
    "when", "who", "which", "there", "here", "then", "than", "so", "up", "out", "no"
}

def extract_keywords(text: str) -> set:
    if not text:
        return set()
    # Normalize: lowercase and replace punctuation with space
    cleaned = re.sub(r'[^\w\s]', ' ', text.lower())
    words = re.findall(r'\b[a-z]{3,}\b', cleaned)
    return {w for w in words if w not in STOPWORDS}

def cosine_similarity(v1: np.ndarray, v2: np.ndarray) -> float:
    dot = np.dot(v1, v2)
    norm1 = np.linalg.norm(v1)
    norm2 = np.linalg.norm(v2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(dot / (norm1 * norm2))

def compute_clarity_score(text: str) -> int:
    if not text or not text.strip():
        return 0
    
    sentences = [s.strip() for s in re.split(r'[.!?]+', text) if s.strip()]
    if not sentences:
        sentences = [text]
        
    words = [w.strip() for w in re.split(r'\s+', text) if w.strip()]
    if not words:
        return 0
        
    avg_sentence_len = len(words) / len(sentences)
    avg_word_len = sum(len(w) for w in words) / len(words)
    
    score = 100
    
    # Penalize too long or too short sentences
    if avg_sentence_len > 25:
        score -= (avg_sentence_len - 25) * 2
    elif avg_sentence_len < 6:
        score -= (6 - avg_sentence_len) * 3
        
    # Penalize too long or too short words
    if avg_word_len > 7:
        score -= (avg_word_len - 7) * 8
    elif avg_word_len < 3.2:
        score -= (3.2 - avg_word_len) * 12
        
    return int(max(20, min(100, score)))

def analyze_text(task_title: str, task_description: str, expected_answer: str | None, employee_response: str) -> dict:
    """
    Perform silent local text submission evaluation using BGE embeddings.
    """
    if not employee_response or not employee_response.strip():
        return {
            "overall_score": 0,
            "metrics": {
                "relevance_score": 0,
                "similarity_score": 0,
                "completeness_score": 0,
                "clarity_score": 0,
                "missing_topics": [],
                "matched_topics": []
            },
            "strengths": [],
            "weaknesses": ["Empty submission received."],
            "detected_issues": ["No response content provided."],
            "improvement_points": ["Please write a complete answer."],
            "model_output": {"error": "Empty response"}
        }

    # Fallback comparison text: task title + task description if expected_answer is empty
    if expected_answer and expected_answer.strip():
        comparison_text = expected_answer.strip()
        expected_keywords = extract_keywords(comparison_text)
    else:
        comparison_text = f"{task_title}\n{task_description}".strip()
        # Extract keywords from title and description
        expected_keywords = extract_keywords(comparison_text)

    # 1. Cosine similarity using BGE
    try:
        emb_comp = bge_model.encode(comparison_text)
        emb_resp = bge_model.encode(employee_response)
        sim = cosine_similarity(emb_comp, emb_resp)
        # Shift cosine similarity range slightly to map sensible minimums to a 0-100 scale
        # BGE base similarities for related texts usually lie between 0.6 and 1.0.
        similarity_score = int(max(0, min(100, (sim - 0.4) / 0.6 * 100)))
    except Exception as e:
        print("[Text Analyzer] BGE embedding failed:", e)
        similarity_score = 50
        sim = 0.5

    relevance_score = similarity_score

    # 2. Keyword/topic coverage
    response_keywords = extract_keywords(employee_response)
    
    if expected_keywords:
        matched_topics = list(expected_keywords.intersection(response_keywords))
        missing_topics = list(expected_keywords.difference(response_keywords))
        completeness_score = int(len(matched_topics) / len(expected_keywords) * 100)
    else:
        matched_topics = list(response_keywords)
        missing_topics = []
        completeness_score = 100

    # 3. Clarity
    clarity_score = compute_clarity_score(employee_response)

    # 4. Overall score synthesis
    if expected_keywords:
        overall_score = int(0.4 * similarity_score + 0.4 * completeness_score + 0.2 * clarity_score)
    else:
        overall_score = int(0.7 * similarity_score + 0.3 * clarity_score)

    overall_score = max(0, min(100, overall_score))

    # Strengths, weaknesses, improvement suggestions
    strengths = []
    weaknesses = []
    improvement_points = []
    detected_issues = []

    if similarity_score >= 70:
        strengths.append("High semantic alignment with task objectives.")
    else:
        weaknesses.append("Response deviates from expected core themes.")
        improvement_points.append("Align the response more closely with the task objectives.")

    if completeness_score >= 75:
        strengths.append("Addressed most key concepts and keywords required.")
    elif completeness_score < 40:
        weaknesses.append("Key topics and operational details are largely missing.")
        if missing_topics:
            detected_issues.append(f"Missing core topics: {', '.join(missing_topics[:3])}")
            improvement_points.append(f"Try to incorporate terms like: {', '.join(missing_topics[:3])}")
    else:
        if missing_topics:
            improvement_points.append(f"Include missed aspects: {', '.join(missing_topics[:2])}")

    if clarity_score >= 80:
        strengths.append("Excellent readability and structured sentence lengths.")
    elif clarity_score < 50:
        detected_issues.append("Low readability or unstructured sentences.")
        improvement_points.append("Use shorter, well-structured sentences to improve clarity.")

    if not strengths:
        strengths.append("Response recorded successfully.")

    return {
        "overall_score": overall_score,
        "metrics": {
            "relevance_score": relevance_score,
            "similarity_score": similarity_score,
            "completeness_score": completeness_score,
            "clarity_score": clarity_score,
            "missing_topics": missing_topics,
            "matched_topics": matched_topics
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": detected_issues,
        "improvement_points": improvement_points,
        "model_output": {
            "model_name": "BGE-base-en-v1.5",
            "cosine_similarity": round(float(sim), 4)
        }
    }

def analyze_mcq(questions: list, answers: list) -> dict:
    """
    Perform silent rule-based MCQ option verification.
    """
    total = len(questions)
    if total == 0:
        return {
            "overall_score": 100,
            "metrics": {"correct_answers": 0, "total_questions": 0, "accuracy": 100},
            "strengths": ["Quiz submitted successfully."],
            "weaknesses": [],
            "detected_issues": [],
            "improvement_points": [],
            "question_analysis": []
        }

    correct_count = 0
    analysis = []
    
    # Map questions by ID for quick lookup
    q_map = {}
    for q in questions:
        q_id = q.get("id") or q.get("question_id")
        if q_id:
            q_map[str(q_id)] = q

    for ans in answers:
        q_id = str(ans.get("question_id") or ans.get("id") or "")
        selected = str(ans.get("selected_option") or "").strip()
        
        q_obj = q_map.get(q_id)
        if q_obj:
            correct = str(q_obj.get("correctAnswer") or q_obj.get("correct_answer") or q_obj.get("correct_answers") or "").strip()
            # If correctAnswer is not there, maybe it's in the answer payload itself as correct_answer
            if not correct:
                correct = str(ans.get("correct_answer") or "").strip()
            
            is_correct = (selected.lower() == correct.lower())
            if is_correct:
                correct_count += 1
            
            analysis.append({
                "question": q_obj.get("question", ""),
                "selected_answer": selected,
                "correct_answer": correct,
                "is_correct": is_correct,
                "feedback": "Correct option selected." if is_correct else f"Incorrect. The correct option was: {correct}"
            })
        else:
            # Fallback if question not found in map
            correct = str(ans.get("correct_answer") or "").strip()
            is_correct = (selected.lower() == correct.lower())
            if is_correct:
                correct_count += 1
            analysis.append({
                "question": ans.get("question", ""),
                "selected_answer": selected,
                "correct_answer": correct,
                "is_correct": is_correct,
                "feedback": "Correct option selected." if is_correct else f"Incorrect. The correct option was: {correct}"
            })

    score = int((correct_count / total) * 100) if total > 0 else 0
    
    strengths = []
    weaknesses = []
    improvement_points = []
    
    if score >= 80:
        strengths.append(f"Demonstrated excellent understanding with {score}% accuracy.")
    elif score >= 50:
        strengths.append(f"Passed the quiz with {score}% accuracy.")
        weaknesses.append("Some concepts need revision.")
        improvement_points.append("Review the questions marked incorrect and try again.")
    else:
        weaknesses.append(f"Low accuracy of {score}%. Key concepts are not clear.")
        improvement_points.append("Review all course materials and retake the quiz.")

    return {
        "overall_score": score,
        "metrics": {
            "correct_answers": correct_count,
            "total_questions": total,
            "accuracy": score
        },
        "strengths": strengths,
        "weaknesses": weaknesses,
        "detected_issues": [f"Incorrectly answered {total - correct_count} questions."] if correct_count < total else [],
        "improvement_points": improvement_points,
        "question_analysis": analysis,
        "model_output": {"type": "rule_based_mcq"}
    }

