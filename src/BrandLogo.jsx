export default function BrandLogo({ className, decorative = false }) {
  return (
    <img
      className={className}
      src="/mr-saloum-logo-header.webp"
      alt={decorative ? '' : 'Mr.Saloum Barbearia'}
      width="400"
      height="460"
    />
  )
}
