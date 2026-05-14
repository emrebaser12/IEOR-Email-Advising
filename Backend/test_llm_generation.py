import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from email_advising import EmailAdvisor, SentenceEmbedder, load_knowledge_base, TfidfRetriever, load_reference_corpus, LLMGenerativeComposer
from email_advising.llm import create_openai_llm
from email_advising.composers import TemplateEmailComposer

print("Loading knowledge base and corpus...")
kb = load_knowledge_base()
corpus = load_reference_corpus()
retriever = TfidfRetriever(corpus)

print("Loading embedding model...")
embedder = SentenceEmbedder()
embedder._load()

print("Setting up OpenAI generative composer...")
llm = create_openai_llm()
composer = LLMGenerativeComposer(
    llm=llm,
    style="professional",
    fallback_composer=TemplateEmailComposer(),
)

print("Creating advisor with OpenAI generative composer...")
advisor = EmailAdvisor(kb, retriever=retriever, composer=composer, embedding_model=embedder)

print("\n" + "="*70)
print("Testing OpenAI-generated email response")
print("="*70 + "\n")

result = advisor.process_query(
    "How do I register for classes this semester?", 
    {"student_name": "Sarah Johnson"}
)

print(f"📧 Subject: {result.subject}")
print(f"\n📝 Body:\n{result.body}")
print(f"\n✅ Confidence: {result.confidence:.2f}")
print(f"🎯 Decision: {result.decision}")
print(f"⚡ Auto-send: {result.auto_send}")
print(f"\n📚 References: {len(result.references)} documents found")
for ref in result.references:
    print(f"  - {ref.title}")
